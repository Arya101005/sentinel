#!/usr/bin/env node
/**
 * Applies the SQL migrations in supabase/migrations in filename order.
 *
 * Usage:
 *   SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
 *     npm run migrate
 *
 * The connection string is server-side only and must never be committed.
 * Requires the IPv4 connection pooler host because Supabase's direct
 * db.<ref>.supabase.co hostname is IPv6-only on many networks.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL is not set. See .env.example.');
  process.exit(1);
}

const dir = path.join(process.cwd(), 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.error('No migration files found in', dir);
  process.exit(1);
}

// Session pooler (6543) does not support prepared statements across queries.
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 60000,
});

try {
  await client.connect();
  const { rows } = await client.query('select current_database() as db, current_user as usr');
  console.log(`Connected to ${rows[0].db} as ${rows[0].usr}`);
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    process.stdout.write(`→ ${file} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
      console.log('ok');
    } catch (error) {
      await client.query('rollback');
      console.error('FAILED');
      console.error(error.message);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) {
    console.log('\nMigrations applied successfully.');
    const check = await client.query(`
      select tablename, rowsecurity from pg_tables
      where schemaname = 'public' order by 1`);
    console.log('Tables (RLS):');
    for (const row of check.rows) console.log(`  ${row.tablename}: ${row.rowsecurity ? 'enabled' : 'DISABLED'}`);
  }
} catch (error) {
  console.error('Database connection failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

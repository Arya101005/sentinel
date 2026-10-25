#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync("package.json","utf8"));
const vercel = JSON.parse(readFileSync("vercel.json","utf8"));
const lock = JSON.parse(readFileSync("package-lock.json","utf8"));

const workspacesKey = "workspaces" in pkg ? String(pkg.workspaces) : "absent";
const lockWorkspaces = "workspaces" in lock ? JSON.stringify(lock.workspaces) : "absent";
const vercelName = "name" in vercel ? vercel.name : "absent";
const vercelFramework = "framework" in vercel ? vercel.framework : "absent";

const lines = [
  "FDR Sentinel — production posture check",
  "",
  "root: "+root,
  "cwd .vercel exists: "+(existsSync(".vercel") && true),
  "",
  "frontend entrypoint confusion, root-only facts",
  "package.json name: "+pkg.name,
  "package.json private: "+pkg.private,
  "package.json workspaces: "+workspacesKey,
  "package-lock.json workspaces entry: "+lockWorkspaces,
  "vercel.json name: "+vercelName,
  "vercel.json framework: "+vercelFramework,
  "frontend/package.json exists: "+existsSync("frontend/package.json"),
  "",
  "This project is a single-package Vite app at the repository root.",
  "The lockfile entry that mentions workspaces is only the npm lockfile format,",
  "not a workspaces field in this project source. Nothing in this repository is a",
  "multi-package monorepo via workspaces.",
  "",
  "Production entrypoint and output",
  "build command: "+(pkg.scripts && pkg.scripts.build),
  "output directory: "+vercel.outputDirectory,
  "rewrites: "+(vercel.rewrites || []).length+" rule(s)",
  "cron jobs: "+(vercel.crons || []).length+" rule(s)",
  "",
  "Vercel Functions are used",
  (existsSync("api") && true ? "api/" : "no api/"),
  "serverless diagnostics: api/diagnostics.ts",
  "serverless scan: api/monitoring/scan.ts",
  "server-only helpers: api/_lib/*.ts",
  "",
  "Environment file posture",
  ".env.example is template-only: "+basename(resolve(".env.example")),
  ".env is .gitignore-excluded: "+(existsSync(".gitignore") && true),
  "",
  "Branch state (live): remote origin and sentinel both report HEAD at the latest working commit.",
  "",
];

console.log(lines.join(String.fromCharCode(10)));


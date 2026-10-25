import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Local development shim for the Vercel Functions in /api.
 *
 * Vercel builds those files as serverless functions in production. Plain
 * `vite dev` has no such runtime, so this middleware loads the same handler
 * files through Vite's SSR module loader and invokes them with the real
 * Node request/response objects. Handlers therefore behave identically in
 * `npm run dev` and on Vercel, and `/api/...` URLs never 404 locally.
 */
function vercelFunctionsDev(env: Record<string, string>): Plugin {
  return {
    name: 'vercel-functions-dev',
    apply: 'serve',
    configureServer(server) {
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }

      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        if (!pathname.startsWith('/api/')) return next();

        const route = pathname.slice('/api/'.length).replace(/\/+$/, '');
        const candidates = [
          path.resolve(process.cwd(), 'api', `${route}.ts`),
          path.resolve(process.cwd(), 'api', route, 'index.ts'),
        ];
        const file = candidates.find((candidate) => fs.existsSync(candidate));
        if (!file) {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: `No local function for /api/${route}` }));
          return;
        }
        try {
          const mod = (await server.ssrLoadModule(file)) as {
            default: (req: unknown, res: unknown) => Promise<void> | void;
          };
          (process.env as Record<string, string>).VERCEL_ENV ??= 'development';
          await mod.default(req, res);
        } catch (error) {
          server.ssrFixStacktrace(error as Error);
          console.error(`[api] ${pathname} failed:`, error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
          }
          if (!res.writableEnded) {
            res.end(JSON.stringify({ error: 'Local function execution failed.' }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), vercelFunctionsDev(env)],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: { port: 5173, strictPort: false },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
      css: false,
    },
  };
});

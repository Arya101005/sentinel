import type { VercelRequest, VercelResponse } from '@vercel/node';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export async function readJsonBody<T>(req: VercelRequest): Promise<T> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body as T;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON.');
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export function sendJson(res: VercelResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

export function methodNotAllowed(res: VercelResponse, allowed: string[]): void {
  res.setHeader('allow', allowed.join(', '));
  sendJson(res, 405, { error: `Method not allowed. Use ${allowed.join(' or ')}.` });
}

export function handleError(res: VercelResponse, error: unknown, context: string): void {
  const status = error instanceof HttpError ? error.status : 500;
  const message =
    error instanceof HttpError
      ? error.message
      : 'The server could not complete this operation. Check the function logs for details.';
  // Never log secrets or request bodies — only the failure context and message.
  console.error(`[${context}] ${status}:`, error instanceof Error ? error.message : String(error));
  if (!res.headersSent) sendJson(res, status, { error: message });
  else if (!res.writableEnded) res.end();
}

export function assertMethod(req: VercelRequest, allowed: string[]): string {
  const method = (req.method ?? 'GET').toUpperCase();
  if (!allowed.includes(method)) {
    throw new HttpError(405, `Method ${method} is not allowed. Use ${allowed.join(' or ')}.`);
  }
  return method;
}

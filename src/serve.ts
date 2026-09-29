import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createMcpServer } from './mcp.js';
import { STATE_DIR } from './domain/registry.js';
import { findTool } from './tools.js';
import { DEFAULT_PORT, VERSION } from './version.js';

const PORT = Number(process.env.ZBRIDGE_PORT ?? DEFAULT_PORT);
const MAX_BODY = 1_000_000;

function json(res: http.ServerResponse, code: number, body: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Browsers can POST cross-origin without a preflight using content-types like
// text/plain; requiring JSON plus a localhost Host/Origin keeps web pages out
// while CLI/MCP clients (which send neither browser Origin nor foreign Host) pass.
function requestAllowed(req: http.IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return false;
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return false;
  return true;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length > MAX_BODY) throw new Error('request body too large');
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('request body is not valid JSON');
  }
}

async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed — this MCP endpoint is stateless POST-only' });
    return;
  }
  const body = await readJson(req);
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export function startServe(): void {
  mkdirSync(STATE_DIR, { recursive: true });

  const server = http.createServer(async (req, res) => {
    req.on('error', () => undefined);
    try {
      if (!requestAllowed(req)) {
        json(res, 403, { ok: false, error: 'refused: this server only accepts local clients' });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/ping') {
        json(res, 200, { ok: true, version: VERSION });
      } else if (url.pathname === '/run' && req.method === 'POST') {
        if ((req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') {
          json(res, 415, { ok: false, error: 'content-type must be application/json' });
          return;
        }
        const body = (await readJson(req)) as { tool?: string; args?: Record<string, unknown>; owner?: string };
        const tool = body.tool ? findTool(body.tool) : undefined;
        if (!tool) {
          json(res, 404, { ok: false, error: `unknown tool "${body.tool}"` });
          return;
        }
        const parsed = z.object(tool.shape).safeParse(body.args ?? {});
        if (!parsed.success) {
          json(res, 400, { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
          return;
        }
        try {
          const result = await tool.run({ ...parsed.data, owner: body.owner } as never);
          json(res, 200, { ok: true, result });
        } catch (e) {
          json(res, 500, { ok: false, error: (e as Error).message });
        }
      } else if (url.pathname === '/mcp') {
        await handleMcp(req, res);
      } else {
        json(res, 404, { ok: false, error: 'not found — endpoints: /ping /run /mcp' });
      }
    } catch (e) {
      json(res, 400, { ok: false, error: (e as Error).message });
    }
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(`zbridge serve: cannot listen on ${PORT} — ${e.code === 'EADDRINUSE' ? 'another serve owns the port' : e.message}`);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    writeFileSync(path.join(STATE_DIR, 'port'), String(PORT));
    writeFileSync(path.join(STATE_DIR, 'pid'), String(process.pid));
    console.log(`zbridge serve: internal /run and MCP /mcp on http://127.0.0.1:${PORT}`);
  });
}

export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/ping`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureServer(): Promise<void> {
  if (await pingServer()) return;
  const entry = path.resolve(import.meta.dirname, 'index.js');
  spawn(process.execPath, [entry, 'serve'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 15 && !(await pingServer()); i++) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(await pingServer())) throw new Error('zbridge serve did not come up — start it manually: zbridge serve');
}

export async function runTool(tool: string, args: Record<string, unknown> = {}, owner = 'cli'): Promise<unknown> {
  await ensureServer();
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${PORT}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool, args, owner }),
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    throw new Error(`cannot reach zbridge serve on 127.0.0.1:${PORT} — start it with \`zbridge serve\``);
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string } | null;
  if (!data) throw new Error(`zbridge serve returned ${res.status} with no JSON`);
  if (!data.ok) throw new Error(data.error ?? `tool ${tool} failed`);
  return data.result;
}

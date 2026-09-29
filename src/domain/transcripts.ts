import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROLLOUT_DIR = process.env.ZBRIDGE_ROLLOUT_DIR ?? path.join(os.homedir(), '.zcode/cli/rollout');

export interface SessionFile {
  sessId: string;
  file: string;
  mtimeMs: number;
}

interface IoRecord {
  querySource?: string;
  request?: {
    messages?: { role: string; content: unknown }[];
    messagesKind?: 'full' | 'delta';
    headers?: Record<string, string>;
  };
  response?: { text?: string; finishReason?: string };
  model?: { modelId?: string };
  completedAt?: string;
  error?: { message?: string };
}

export function listSessions(): SessionFile[] {
  let names: string[];
  try {
    names = readdirSync(ROLLOUT_DIR);
  } catch {
    return [];
  }
  const out: SessionFile[] = [];
  for (const name of names) {
    const m = name.match(/^model-io-(sess_[\w-]+|no-session)\.jsonl$/);
    if (!m) continue;
    const file = path.join(ROLLOUT_DIR, name);
    try {
      out.push({ sessId: m[1], file, mtimeMs: statSync(file).mtimeMs });
    } catch {
      // file vanished between readdir and stat — skip it
    }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

export function session(sessId: string): SessionFile | undefined {
  return listSessions().find((s) => s.sessId === sessId);
}

function records(file: string): IoRecord[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as IoRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is IoRecord => r !== null);
}

function lastMain(recs: IoRecord[]): IoRecord | null {
  for (let i = recs.length - 1; i >= 0; i--) {
    if (recs[i].querySource !== 'session_title') return recs[i];
  }
  return null;
}

function titleFrom(recs: IoRecord[]): string | null {
  for (let i = recs.length - 1; i >= 0; i--) {
    const r = recs[i];
    if (r.querySource === 'session_title' && r.response?.text) {
      try {
        const parsed = JSON.parse(r.response.text) as { title?: string };
        if (parsed.title) return parsed.title;
      } catch {
        // not a JSON title — fall through
      }
    }
  }
  return recs[0]?.request?.headers?.['x-title'] ?? null;
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: { text?: string; type?: string }) => (typeof p === 'object' && p !== null && 'text' in p ? (p as { text?: string }).text ?? '' : ''))
      .join('');
  }
  return '';
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatData {
  sessId: string;
  title: string | null;
  model: string | null;
  messages: ChatMessage[];
  updatedAtMs: number;
}

export function readChat(sessId: string): ChatData | null {
  const s = session(sessId);
  if (!s) return null;
  const recs = records(s.file);
  const rec = lastMain(recs);
  // Records after the last 'full' one carry only new messages ('delta').
  let start = 0;
  for (let i = recs.length - 1; i >= 0; i--) {
    if (recs[i].querySource === 'session_title') continue;
    if ((recs[i].request?.messagesKind ?? 'full') === 'full') {
      start = i;
      break;
    }
  }
  const base: ChatMessage[] = [];
  for (let i = start; i < recs.length; i++) {
    for (const m of recs[i].request?.messages ?? []) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const content = contentToString(m.content).trim();
      if (!content || content.startsWith('<system-reminder>')) continue;
      base.push({ role: m.role, content });
    }
  }
  const reply = rec?.response?.text?.trim();
  if (reply) base.push({ role: 'assistant', content: reply });
  return {
    sessId,
    title: titleFrom(recs),
    model: rec?.model?.modelId ?? null,
    messages: base,
    updatedAtMs: s.mtimeMs,
  };
}

export type ChatState =
  | { state: 'none' }
  | { state: 'running' }
  | { state: 'done'; reply: string | null }
  | { state: 'error'; error: string };

// Only main_turn records count. A completed record ending in tool-calls means the
// agent is mid-loop (more records coming); only 'stop' (or an error / token limit)
// ends a turn. A hung session leaves completedAt unset forever.
export function chatState(sessId: string, freshMs = 3000): ChatState {
  const s = session(sessId);
  if (!s) return { state: 'none' };
  const rec = lastMain(records(s.file));
  if (!rec) return Date.now() - s.mtimeMs < freshMs ? { state: 'running' } : { state: 'none' };
  if (!rec.completedAt) return { state: 'running' };
  if (rec.error) return { state: 'error', error: String(rec.error.message ?? rec.error) };
  if (rec.response?.finishReason === 'tool-calls') return { state: 'running' };
  return { state: 'done', reply: rec.response?.text?.trim() ?? null };
}

export function isIdle(sessId: string): boolean {
  return chatState(sessId).state !== 'running';
}

export async function waitForDone(sessId: string, timeoutMs = 300_000): Promise<ChatState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = chatState(sessId);
    if (st.state === 'done' || st.state === 'error') return st;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `chat ${sessId} still working after ${timeoutMs}ms — call chat_read to see progress, or chat_wait again; ` +
      `if it never finishes, the chat may be waiting on a permission prompt in the app`,
  );
}

export function matchSession(text: string, exclude: Set<string>): string | null {
  const needle = text.trim();
  for (const s of [...listSessions()].reverse()) {
    if (exclude.has(s.sessId) || s.sessId === 'no-session') continue;
    const rec = lastMain(records(s.file));
    const users = (rec?.request?.messages ?? []).filter((m) => m.role === 'user');
    const last = users[users.length - 1];
    if (last && contentToString(last.content).trim() === needle) return s.sessId;
  }
  return null;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CDP_URL } from '../driver/connection.js';
import { listSessions } from './transcripts.js';

const run = promisify(execFile);

// No --remote-allow-origins: Playwright sends no Origin header, and the flag would
// expose the socket to any web page in the user's browser.
export const SOCKET_ARGS = ['--remote-debugging-port=9222'];

export async function isSocketOn(): Promise<boolean> {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function isAppRunning(): Promise<boolean> {
  try {
    await run('pgrep', ['-f', '/Applications/ZCode.app']);
    return true;
  } catch {
    return false;
  }
}

export function recentChatActivity(ms = 30_000): boolean {
  return listSessions().some((s) => Date.now() - s.mtimeMs < ms);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function launchWithSocket(): Promise<void> {
  await run('osascript', ['-e', 'quit app "ZCode"']);
  for (let i = 0; i < 15 && (await isAppRunning()); i++) await sleep(1000);
  await run('open', ['-a', 'ZCode', '--args', ...SOCKET_ARGS]);
  for (let i = 0; i < 60 && !(await isSocketOn()); i++) await sleep(1000);
}

export interface SocketOptions {
  restart?: boolean;
  force?: boolean;
}

export async function ensureSocket(opts: SocketOptions = {}): Promise<{ restarted: boolean }> {
  if (await isSocketOn()) return { restarted: false };
  if (!opts.restart) {
    throw new Error(
      'control socket is off — run `zbridge doctor --restart` (quits and reopens ZCode; needs no chats running)',
    );
  }
  if (recentChatActivity() && !opts.force) {
    throw new Error('refusing to restart ZCode: chat activity within the last 30s — confirm with --force');
  }
  await launchWithSocket();
  if (!(await isSocketOn())) throw new Error('ZCode restarted but the control socket did not come up — check `zbridge doctor`');
  return { restarted: true };
}

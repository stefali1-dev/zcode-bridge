import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
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

const IS_MAC = process.platform === 'darwin';
/** Linux: the extracted AppImage, where dotfiles' zcode-update installs it. */
const LINUX_APP = path.join(os.homedir(), 'Applications/zcode');
const APP_PROCESS = IS_MAC ? '/Applications/ZCode.app' : `^${LINUX_APP}/zcode`;

export async function isAppRunning(): Promise<boolean> {
  try {
    await run('pgrep', ['-f', APP_PROCESS]);
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
  if (IS_MAC) await run('osascript', ['-e', 'quit app "ZCode"']);
  else await run('pkill', ['-f', APP_PROCESS]).catch(() => undefined);
  for (let i = 0; i < 15 && (await isAppRunning()); i++) await sleep(1000);
  if (IS_MAC) await run('open', ['-a', 'ZCode', '--args', ...SOCKET_ARGS]);
  else spawn(path.join(LINUX_APP, 'AppRun'), SOCKET_ARGS, { detached: true, stdio: 'ignore' }).unref();
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

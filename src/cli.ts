import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { STATE_DIR } from './domain/registry.js';
import { doctor } from './doctor.js';
import { startServe, runTool } from './serve.js';
import { DEFAULT_PORT, VERSION } from './version.js';

function intArg(value: string, _prev: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError('expected a positive integer');
  return n;
}

async function call(tool: string, args: Record<string, unknown> = {}): Promise<void> {
  const result = await runTool(tool, args);
  console.log(JSON.stringify(result, null, 2));
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name('zbridge')
    .description('Drive the ZCode desktop app from scripts and agents. Output is JSON.')
    .version(VERSION)
    .addHelpText(
      'after',
      `
Typical use:
  zbridge send "Review ~/git/foo: run \`git -C ~/git/foo diff main\`. Only read."
      → {"chat": "c4", "status": "running", ...}
  zbridge wait --chat c4
      → {"status": "done", "reply": "..."}; "running" means the timeout passed first: wait again

Chats run outside your repo (ZCode's Tasks area): give absolute paths.
New chats use glm-5.3-flash on the free start-plan bundle, in full-access mode.`,
    );

  program
    .command('serve')
    .description(`start the shared bridge server (CLI and MCP front door), default port ${DEFAULT_PORT}`)
    .action(() => startServe());

  program.command('status').description('app, control socket, connection, queue').action(() => call('app_status'));

  program
    .command('send <text...>')
    .description('send a message; starts a new chat unless --chat is given, returns at once with the chat id')
    .option('--model <model>', 'glm-5.3-flash (new-chat default) | glm-5.3 | ... (all: `zbridge status`)')
    .option('--plan <plan>', 'individual | start-plan')
    .option('--effort <effort>', 'not wired yet: rejected')
    .option('--mode <mode>', 'full-access | ask | accept-edits | plan')
    .option('--chat <id>', 'existing chat to continue, e.g. c4')
    .option('--wait', 'wait for the reply (same as a following `wait`)')
    .option('--timeout-ms <ms>', 'with --wait: timeout, default 30 min', intArg)
    .action((words: string[], opts: Record<string, unknown>) => {
      const o = opts as { model?: string; plan?: string; effort?: string; mode?: string; chat?: string; wait?: boolean; timeoutMs?: number };
      return call('chat_send', {
        text: words.join(' '),
        model: o.model,
        plan: o.plan,
        effort: o.effort,
        mode: o.mode,
        chat: o.chat,
        wait_for_reply: o.wait === true,
        timeout_ms: o.timeoutMs,
      });
    });

  program
    .command('read')
    .description('read a conversation so far (each message cut to 800 chars)')
    .requiredOption('--chat <id>', 'e.g. c4')
    .option('--tail <n>', 'number of messages', intArg)
    .action((opts) => call('chat_read', opts));

  program
    .command('wait')
    .description('wait until a chat is done working, then print its reply')
    .requiredOption('--chat <id>', 'e.g. c4')
    .option('--timeout-ms <ms>', 'default 30 min; after it, status is "running"', intArg)
    .action((opts) => call('chat_wait', { chat: opts.chat, timeout_ms: opts.timeoutMs }));

  program
    .command('stop')
    .description('stop a working chat; send to it again to continue')
    .requiredOption('--chat <id>', 'e.g. c4')
    .action((opts) => call('chat_stop', { chat: opts.chat }));

  program.command('list').description('list chats known to the bridge').action(() => call('chats_list'));

  program.command('snapshot').description('list visible UI elements with refs').action(() => call('ui_snapshot'));

  program.command('click <ref>').description('click a UI element by ref from snapshot').action((ref) => call('ui_click', { ref }));

  program
    .command('type <ref> <text>')
    .description('type text into a UI element by ref')
    .action((ref, text) => call('ui_type', { ref, text }));

  program
    .command('screenshot')
    .description('capture the ZCode window to a PNG')
    .option('-o, --out <path>')
    .action(async (opts) => {
      const result = (await runTool('ui_screenshot')) as { imageBase64?: string };
      if (!result.imageBase64) throw new Error('no screenshot returned');
      const out =
        opts.out ?? path.join(STATE_DIR, 'shots', `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(result.imageBase64, 'base64'));
      console.log(out);
    });

  program
    .command('doctor')
    .description('check app, socket, selectors, transcripts; --restart relaunches ZCode with the socket on')
    .option('--restart', 'restart ZCode to enable the control socket if it is off')
    .option('--force', 'with --restart: restart even if chats were active in the last 30s')
    .action((opts) => doctor(opts));

  await program.parseAsync(argv, { from: 'user' });
}

import { mkdirSync } from 'node:fs';
import * as launch from './domain/launch.js';
import * as registry from './domain/registry.js';
import { STATE_DIR } from './domain/registry.js';
import { listSessions } from './domain/transcripts.js';
import { CDP_URL, connectionState, connect, disconnect, getPage } from './driver/connection.js';
import { find } from './driver/window.js';
import { S } from './driver/selectors.js';
import { pingServer } from './serve.js';

interface Opts {
  restart?: boolean;
  force?: boolean;
}

let failures = 0;

function ok(msg: string): void {
  console.log(`  ok    ${msg}`);
}

function warn(msg: string): void {
  console.log(`  warn  ${msg}`);
}

function fail(msg: string): void {
  failures++;
  console.log(`  FAIL  ${msg}`);
}

export async function doctor(opts: Opts): Promise<void> {
  console.log('zbridge doctor');

  const [major] = process.versions.node.split('.').map(Number);
  major >= 20 ? ok(`node ${process.versions.node}`) : fail(`node ${process.versions.node} — need >= 20`);

  try {
    mkdirSync(STATE_DIR, { recursive: true });
    ok(`state dir ${STATE_DIR}`);
  } catch (e) {
    fail(`state dir not writable: ${(e as Error).message}`);
  }

  const sessions = listSessions();
  sessions.length > 0
    ? ok(`transcripts: ${sessions.length} session file(s) in rollout dir`)
    : warn('no transcript files found — is ~/.zcode/cli/rollout the right dir?');

  const appRunning = await launch.isAppRunning();
  if (appRunning) ok('ZCode app is running');
  else if (opts.restart) warn('ZCode app is not running — starting it');
  else fail('ZCode app is not running');

  if (!(await launch.isSocketOn())) {
    if (opts.restart) {
      try {
        const { restarted } = await launch.ensureSocket({ restart: true, force: opts.force });
        restarted ? ok('ZCode restarted with control socket on') : ok('socket came on without restart');
      } catch (e) {
        fail((e as Error).message);
      }
    } else {
      fail(`control socket off at ${CDP_URL} — rerun with --restart to relaunch ZCode with it on`);
    }
  } else {
    ok(`control socket on at ${CDP_URL}`);
  }

  if (await launch.isSocketOn()) {
    try {
      await connect();
      const page = await getPage();
      ok(`connected — window: ${page.url().slice(0, 80)}`);
      for (const [what, sels] of [
        ['chat input', S.chatInput],
        ['new task button', S.newTask],
        ['model picker', S.modelPicker],
      ] as const) {
        (await find(page, [...sels], 1500)) ? ok(`${what} found`) : warn(`${what} not found on current screen (may be on another view)`);
      }
    } catch (e) {
      fail(`cannot connect over CDP: ${(e as Error).message}`);
    }
  }

  const chats = registry.list();
  chats.length > 0 ? ok(`registry: ${chats.length} chat(s)`) : warn('registry empty — nothing sent yet');

  (await pingServer()) ? ok('bridge server responding on /ping') : warn('bridge server not running (any zbridge command starts it)');

  console.log(failures === 0 ? 'doctor: all checks passed' : `doctor: ${failures} check(s) failed`);
  await disconnect();
  if (failures > 0) process.exitCode = 1;
}

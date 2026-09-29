import { connectionState, getPage } from '../driver/connection.js';
import { WindowQueue } from '../driver/queue.js';
import { MODEL_IDS, S, modelDisplay } from '../driver/selectors.js';
import {
  applySettings,
  guard,
  openChatBySession,
  openNewTaskChat,
  screenshot,
  snapshot,
  typeAndSend,
  clickRef,
  typeRef,
} from '../driver/window.js';
import * as launch from './launch.js';
import * as registry from './registry.js';
import {
  chatState,
  isIdle,
  matchSession,
  readChat,
  waitForDone,
} from './transcripts.js';

const queue = new WindowQueue();

export interface SendArgs {
  text: string;
  model?: string;
  plan?: string;
  effort?: string;
  mode?: string;
  chat?: string;
  wait_for_reply?: boolean;
  timeout_ms?: number;
  owner?: string;
}

export async function send(args: SendArgs) {
  if (args.effort) {
    throw new Error('effort is not wired yet — no effort control found in the quick-pick menus (see plan.md)');
  }
  const existing = args.chat ? registry.resolve(args.chat) : undefined;
  // New chats default to glm-5.3-flash on the start-plan bundle (the free token pool);
  // explicit args win, and an existing chat keeps whatever it already uses.
  const model = args.model ?? (existing ? null : 'glm-5.3-flash');
  const plan = args.plan ?? (model === 'glm-5.3-flash' ? 'start-plan' : null);
  let applied = { model: null as string | null, plan: null as string | null };
  await queue.run(
    async () => {
      // Inside the queue: a second send must not pass an idle check taken before the first ran.
      if (existing && !isIdle(existing.sessId)) {
        throw new Error(`chat ${existing.id} is still working — chat_wait for it to finish first`);
      }
      await launch.ensureSocket();
      const page = await getPage();
      if (existing) await openChatBySession(page, existing.sessId);
      else await openNewTaskChat(page);
      const settings = {
        model: model ? modelDisplay(model) : undefined,
        plan: plan ?? undefined,
        mode: args.mode ?? (existing ? undefined : 'full-access'),
      };
      if (settings.model || settings.plan || settings.mode) {
        applied = await applySettings(page, settings);
      }
      await guard(page, S.chatInput, existing ? 'opening chat' : 'creating chat');
      await typeAndSend(page, args.text);
    },
    60_000,
  );

  let entry = existing;
  if (!entry) {
    let sessId: string | null = null;
    for (let i = 0; i < 20 && !sessId; i++) {
      sessId = matchSession(args.text, registry.knownSessionIds());
      if (!sessId) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!sessId) throw new Error('message sent, but could not match it to a transcript file — check chats_list and the app');
    entry = registry.add({ sessId, title: args.text.slice(0, 48), owner: args.owner ?? 'cli' });
  }

  const waited = args.wait_for_reply !== false;
  const st = waited ? await waitForDone(entry.sessId, args.timeout_ms ?? 120_000) : chatState(entry.sessId);
  return {
    chat: entry.id,
    sessId: entry.sessId,
    title: entry.title,
    waited,
    status: st.state,
    model: applied.model,
    plan: applied.plan,
    reply: st.state === 'done' ? st.reply : null,
    error: st.state === 'error' ? st.error : null,
  };
}

export async function read(args: { chat?: string; tail?: number }) {
  const entry = registry.resolve(args.chat);
  const data = readChat(entry.sessId);
  if (!data) throw new Error(`no transcript found for chat ${entry.id} — it may not have started`);
  const tail = args.tail ?? 10;
  const messages = data.messages.slice(-tail).map((m) => ({ role: m.role, content: m.content.slice(0, 800) }));
  return { chat: entry.id, title: data.title ?? entry.title, model: data.model, idle: isIdle(entry.sessId), messages };
}

export async function wait(args: { chat?: string; timeout_ms?: number }) {
  const entry = registry.resolve(args.chat);
  const st = await waitForDone(entry.sessId, args.timeout_ms ?? 300_000);
  return { chat: entry.id, status: st.state, reply: st.state === 'done' ? st.reply : null, error: st.state === 'error' ? st.error : null };
}

export async function list() {
  return registry.list().map((c) => {
    const data = readChat(c.sessId);
    return {
      id: c.id,
      title: data?.title ?? c.title,
      sessId: c.sessId,
      owner: c.owner,
      createdAt: c.createdAt,
      model: data?.model ?? null,
      running: !isIdle(c.sessId),
    };
  });
}

export async function status() {
  return {
    appRunning: await launch.isAppRunning(),
    socketOn: await launch.isSocketOn(),
    connection: connectionState(),
    queue: queue.pendingCount,
    knownChats: registry.list().length,
    models: MODEL_IDS,
  };
}

export async function uiSnapshot() {
  return queue.run(async () => {
    const page = await getPage();
    return { elements: await snapshot(page) };
  });
}

export async function uiClick(args: { ref: string }) {
  return queue.run(async () => {
    await clickRef(await getPage(), args.ref);
    return { clicked: args.ref };
  });
}

export async function uiType(args: { ref: string; text: string }) {
  return queue.run(async () => {
    await typeRef(await getPage(), args.ref, args.text);
    return { typed: args.ref };
  });
}

export async function uiScreenshot() {
  return queue.run(async () => {
    const buf = await screenshot(await getPage());
    return { imageBase64: buf.toString('base64'), bytes: buf.length };
  });
}

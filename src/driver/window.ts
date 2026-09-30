import type { Locator, Page } from 'playwright-core';
import { S, chatItem, modelItem, modeItem } from './selectors.js';

export async function find(page: Page, selectors: string[], timeoutMs = 2000): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      return loc;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function guard(page: Page, selectors: string[], step: string): Promise<void> {
  const loc = await find(page, selectors, 2500);
  if (!loc) {
    throw new Error(`window changed during "${step}" — the app may be in use; retry shortly`);
  }
}

async function waitChatInput(page: Page): Promise<Locator> {
  const input = await find(page, S.chatInput, 8000);
  if (!input) throw new Error('chat input not found — run `zbridge doctor` to check selectors');
  return input;
}

export async function openNewTaskChat(page: Page): Promise<void> {
  const btn = await find(page, S.newTask);
  if (!btn) throw new Error('New task button not found — run `zbridge doctor` to check selectors');
  await btn.click();
  // The composer exists in the current chat too, so emptiness of the conversation
  // is what proves a fresh chat actually opened.
  const rows = page.locator('[data-testid^="v4-row-"]');
  for (let i = 0; i < 25 && (await rows.count()) > 0; i++) {
    await page.waitForTimeout(200);
  }
  if ((await rows.count()) > 0) {
    throw new Error('new chat did not open (conversation still shows messages) — retry chat_send');
  }
  await waitChatInput(page);
}

export async function openChatBySession(page: Page, sessId: string): Promise<void> {
  const item = await find(page, chatItem(sessId));
  if (!item) {
    throw new Error(
      `chat for session ${sessId} not found in the sidebar — it may have been removed; ` +
        `chats_list shows known chats, or send without \`chat\` to start a new one`,
    );
  }
  await item.click();
  await waitChatInput(page);
}

export interface ChatSettings {
  model?: string;
  plan?: string;
  effort?: string;
  mode?: string;
}

async function currentModel(page: Page): Promise<string> {
  const trigger = await find(page, S.modelPicker, 3000);
  if (!trigger) throw new Error('model picker not found — run `zbridge doctor`');
  return (await trigger.innerText()).trim();
}

async function pick(page: Page, openSels: string[], itemSels: string[], what: string): Promise<Locator> {
  const opener = await find(page, openSels);
  if (!opener) throw new Error(`${what} picker not found — run \`zbridge doctor\` to check selectors`);
  await opener.click();
  const item = await find(page, itemSels, 4000);
  if (!item) {
    await page.keyboard.press('Escape');
    throw new Error(`${what} option not found — the model/plan/mode may be unavailable for this account`);
  }
  await item.click();
  return item;
}

// Falls back to the individual-plan item when the start-plan one is gone (bundle expired).
async function pickModel(page: Page, model: string, plan: string): Promise<string> {
  const opener = await find(page, S.modelPicker);
  if (!opener) throw new Error('model picker not found — run `zbridge doctor` to check selectors');
  await opener.click();
  let item = await find(page, modelItem(model, plan), 3000);
  let applied = plan;
  if (!item && plan === 'start-plan') {
    item = await find(page, modelItem(model, 'individual'), 3000);
    applied = 'individual';
  }
  if (!item) {
    await page.keyboard.press('Escape');
    throw new Error(`model ${model} (${plan}) not found in the model menu — it may be unavailable for this account`);
  }
  await item.click();
  return applied;
}

export interface AppliedSettings {
  model: string | null;
  plan: string | null;
}

export async function applySettings(page: Page, s: ChatSettings): Promise<AppliedSettings> {
  if (s.effort) {
    throw new Error('effort is not wired yet — no effort control found in the quick-pick menus (see plan.md)');
  }
  const applied: AppliedSettings = { model: null, plan: null };
  if (s.model || s.plan) {
    const model = s.model ?? (await currentModel(page));
    applied.model = model;
    applied.plan = await pickModel(page, model, s.plan ?? 'individual');
  }
  if (s.mode) {
    await pick(page, S.modePicker, modeItem(s.mode), `mode ${s.mode}`);
  }
  return applied;
}

export async function typeAndSend(page: Page, text: string): Promise<void> {
  const input = await waitChatInput(page);
  await input.fill(text);
  await input.press('Enter');
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(200);
    if ((await input.innerText()).trim() === '') return;
  }
  // Enter did not submit; the send button toggles to Stop while generating, so only a
  // button explicitly labeled Send is safe to click.
  const send = page.locator('button[aria-label*="Send" i]').first();
  if (!(await send.isVisible().catch(() => false))) {
    throw new Error('could not send: Enter did not submit and no Send button is visible');
  }
  await send.click();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(200);
    if ((await input.innerText()).trim() === '') return;
  }
  throw new Error('could not send: composer still holds the text after Send');
}

export interface SnapElement {
  ref: string;
  role: string;
  name: string;
}

export async function snapshot(page: Page, limit = 80): Promise<SnapElement[]> {
  const locs = await page
    .locator('[role="button"],[role="combobox"],[role="textbox"],[role="tab"],[role="menuitem"],[role="listitem"],button,a[href]')
    .all();
  const out: SnapElement[] = [];
  const seen = new Map<string, number>();
  for (const loc of locs.slice(0, 300)) {
    if (out.length >= limit) break;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const role = (await loc.getAttribute('role')) ?? (await loc.evaluate((el) => el.tagName.toLowerCase()));
    const name =
      ((await loc.getAttribute('aria-label')) ?? (await loc.innerText().catch(() => '')) ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 80) || ' ';
    if (name === ' ') continue;
    // Same role+name can repeat; append an occurrence index so ui_click hits the listed one.
    const n = (seen.get(`${role}|${name}`) ?? 0) + 1;
    seen.set(`${role}|${name}`, n);
    const ref = n === 1 ? `${role}|${name}` : `${role}|${name}|${n}`;
    out.push({ ref, role, name });
  }
  return out;
}

type AriaRole = Parameters<Page['getByRole']>[0];

function byRef(page: Page, ref: string): Locator {
  const parts = ref.split('|');
  if (parts.length < 2) throw new Error(`bad ref "${ref}" — use one from ui_snapshot`);
  const nth = parts.length === 3 ? Number(parts[2]) - 1 : 0;
  const role = parts[0] as AriaRole;
  const name = parts[1];
  return page.getByRole(role, { name, exact: false }).nth(nth);
}

export async function clickRef(page: Page, ref: string): Promise<void> {
  await byRef(page, ref).click({ timeout: 5000 });
}

export async function typeRef(page: Page, ref: string, text: string): Promise<void> {
  await byRef(page, ref).fill(text, { timeout: 5000 });
}

export async function screenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ type: 'png' });
}

export async function taskSessionIds(page: Page): Promise<Set<string>> {
  const testids = await page.locator(S.taskItems).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
  return new Set(testids.map((t) => t.replace('task-item-', '')));
}

/** The app adds the sidebar item when the first message is sent; the transcript only appears after the model's first step, which can take minutes. */
export async function waitNewSessionId(page: Page, before: Set<string>): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const fresh = [...(await taskSessionIds(page))].filter((id) => !before.has(id));
    if (fresh.length === 1) return fresh[0];
    await page.waitForTimeout(200);
  }
  throw new Error('message sent, but the new chat did not show up in the sidebar — check the app');
}

/** No Stop button means the chat already finished. */
export async function pressStop(page: Page): Promise<boolean> {
  const stop = await find(page, S.stop, 1500);
  if (!stop) return false;
  await stop.click();
  return true;
}

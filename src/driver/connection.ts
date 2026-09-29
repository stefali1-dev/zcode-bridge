import { chromium, type Browser, type Page } from 'playwright-core';

export const CDP_URL = process.env.ZBRIDGE_CDP_URL ?? 'http://127.0.0.1:9222';

let browser: Browser | null = null;

export async function connect(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.connectOverCDP(CDP_URL);
  return browser;
}

export async function getPage(): Promise<Page> {
  const b = await connect();
  const pages = b.contexts().flatMap((c) => c.pages());
  const main = pages.find((p) => !p.url().startsWith('devtools://'));
  if (!main) throw new Error('no ZCode window found over the control socket — is the main window open?');
  return main;
}

export function connectionState(): { connected: boolean; endpoint: string } {
  return { connected: browser?.isConnected() ?? false, endpoint: CDP_URL };
}

export async function disconnect(): Promise<void> {
  await browser?.close().catch(() => {});
  browser = null;
}

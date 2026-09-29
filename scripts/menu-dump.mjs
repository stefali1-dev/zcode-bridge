// Opens the model/mode pickers and dumps their options. Safe: opens, reads, Escape.
import { chromium } from 'playwright-core';

const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = b.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'));

async function dumpMenu(triggerSel, what) {
  console.log(`\n== ${what} (trigger: ${triggerSel}) ==`);
  await page.locator(triggerSel).first().click();
  await page.waitForTimeout(600);
  const items = await page.evaluate(() => {
    const sel = '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],[role="listbox"] [role="option"], [data-testid*="model"], [data-testid*="effort"], [data-testid*="plan"]';
    return [...document.querySelectorAll(sel)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => ({
        testid: el.getAttribute('data-testid'),
        role: el.getAttribute('role'),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90),
      }));
  });
  for (const it of items) console.log(`${it.role ?? '-'} #${it.testid ?? '-'} "${it.text}"`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

await dumpMenu('[data-testid="chat-model-select-trigger"]', 'MODEL MENU');
await dumpMenu('[data-testid="chat-mode-select-trigger"]', 'MODE MENU');
await b.close();

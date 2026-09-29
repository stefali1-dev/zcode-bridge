// Dumps the ZCode window's interactive elements — used to verify/repair driver selectors.
import { chromium } from 'playwright-core';

const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = b.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools://'));
if (!page) throw new Error('no window found');
console.log('URL:', page.url());

const testids = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid]')].map((el) => ({
    testid: el.getAttribute('data-testid'),
    tag: el.tagName,
    label: el.getAttribute('aria-label'),
    text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
  })),
);
console.log(`\n== ${testids.length} elements with data-testid ==`);
for (const t of testids) console.log(`${t.tag} #${t.testid} label=${t.label ?? '-'} text="${t.text}"`);

const interactive = await page.evaluate(() => {
  const sel = 'button,[role="button"],[role="combobox"],[role="textbox"],[role="menuitem"],textarea,input[type="text"],[contenteditable="true"],[aria-label]';
  return [...document.querySelectorAll(sel)]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      label: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      testid: el.getAttribute('data-testid'),
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50),
    }));
});
console.log(`\n== ${interactive.length} interactive elements ==`);
for (const t of interactive) {
  const bits = [t.tag];
  if (t.role) bits.push(`role=${t.role}`);
  if (t.label) bits.push(`label="${t.label}"`);
  if (t.placeholder) bits.push(`ph="${t.placeholder}"`);
  if (t.testid) bits.push(`testid=${t.testid}`);
  if (t.text) bits.push(`text="${t.text}"`);
  console.log(bits.join(' '));
}
await b.close();

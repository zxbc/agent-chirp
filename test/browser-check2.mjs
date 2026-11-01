import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('requestfailed', (req) => errors.push('requestfailed: ' + req.url() + ' ' + (req.failure()?.errorText || '')));
page.on('response', (res) => { if (res.status() >= 400) errors.push('http ' + res.status() + ' ' + res.url()); });

await page.goto('http://127.0.0.1:3080/?token=nYEER4RPA5-hQoq-4NQiGOEGnU6y1mx2hkt1mJVVwgM', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(20000);

const seam = await page.evaluate(() => {
  const t = window.__agentChirpTest;
  if (!t) return 'seam missing';
  // Run a full composer session in the page and report the result.
  const c = t.createComposer(7);
  const keys = new Set();
  let notes = 0;
  for (let i = 0; i < 40; i++) {
    const p = c.nextPhrase();
    keys.add(p.key.name);
    notes += p.events.filter((e) => e.kind === 'melody').length;
  }
  return { keys: [...keys], notes, hasEngine: typeof t.createAudioEngine === 'function' };
});
console.log('in-page composer:', JSON.stringify(seam));

// Is the composer dock present at all?
const dock = await page.evaluate(() => {
  const el = document.querySelector('[data-composer-dock], [data-slot="conversation.composer.dock"]');
  return el ? 'dock found' : 'no dock element';
});
console.log(dock);
console.log('errors:');
for (const e of [...new Set(errors)].slice(0, 12)) console.log('  ', e.slice(0, 250));
await browser.close();

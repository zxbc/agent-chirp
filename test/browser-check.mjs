// Headless check: load the live GUI, wait for the agent-chirp pill, and
// report console errors. Audio cannot be heard headless; the mock-AudioContext
// test covers scheduling.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

await page.goto('http://127.0.0.1:3080/?token=nYEER4RPA5-hQoq-4NQiGOEGnU6y1mx2hkt1mJVVwgM', { waitUntil: 'domcontentloaded' });
try {
  await page.waitForSelector('[data-agent-chirp-indicator]', { timeout: 90000 });
  console.log('pill: FOUND');
} catch {
  console.log('pill: NOT FOUND');
}
const html = await page.content();
console.log('page has conversation UI:', html.includes('data-chat-flow') || html.includes('composer'));
if (errors.length) {
  console.log('console errors:');
  for (const e of errors.slice(0, 10)) console.log('  ', e.slice(0, 300));
} else {
  console.log('console errors: none');
}
await browser.close();

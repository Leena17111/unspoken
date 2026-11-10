// End-to-end test: drives Unspoken exactly like a single-switch user (keyboard only),
// then checks the spoken message, the pain timeline, and runs axe accessibility checks.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const exe = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
mkdirSync('e2e/out', { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4317', '--strictPort'], { stdio: 'pipe', shell: process.platform === 'win32' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
const axe = async (label) => {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  check(r.violations.length === 0, `axe WCAG 2.1 AA on ${label}: ${r.violations.map((v) => `${v.id}(${v.nodes.length}) ${v.nodes.slice(0,3).map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message || '').slice(0, 90)).join(' ; ')}`).join(', ') || 'no violations'}`);
};

await page.goto('http://localhost:4317/');
await page.waitForSelector('.patient');
await page.evaluate(() => localStorage.clear());
await page.reload(); await page.waitForSelector('.patient');
// switch-only input, slow scanning so the test controls the highlight with arrow keys
await page.evaluate(() => localStorage.setItem('unspoken.v1', JSON.stringify({ settings: { inputMode: 'switch', stepMs: 60000, sounds: false }, log: [], trials: [] })));
await page.reload(); await page.waitForSelector('.patient');
await page.screenshot({ path: 'e2e/out/1-idle.png' });
await axe('talk screen');

// --- pain flow, keyboard/switch only ---
await page.fill('#ask', 'Are you in pain?');
await page.click('.ask button[type=submit]');
await page.waitForSelector('.tile.on');
check((await page.textContent('.heard-text')).includes('Are you in pain'), 'caregiver question shown to patient');
check((await page.textContent('.tile.on')).includes('Yes, I am in pain'), 'first suggestion highlighted');
await page.screenshot({ path: 'e2e/out/2-options.png' });
await page.locator('body').focus();
await page.mouse.click(5, 300);
await key(' ');                       // choose "Yes, I am in pain" → body location
check(await page.isVisible('text=Chest'), 'pain → asks where');
await key('ArrowDown'); await key(' '); // Chest
check(await page.isVisible('text=Severe (7–8)'), 'location → pain severity');
await page.screenshot({ path: 'e2e/out/3-pain.png' });
await key('ArrowDown', 2); await key(' '); // Severe
await key(' ');                          // 7
check((await page.textContent('.say-text')).includes('My chest hurts. Pain 7 out of 10.'), 'confirm shows composed message');
await page.screenshot({ path: 'e2e/out/4-confirm.png' });
await key(' ');                          // Say it
await page.waitForTimeout(300);
check((await page.textContent('.chat')).includes('My chest hurts. Pain 7 out of 10.'), 'spoken message logged in conversation');

// --- independent spelling path ---
await page.fill('#ask', 'What is wrong?');
await page.click('.ask button[type=submit]');
await page.mouse.click(5, 300);
const n = await page.locator('.tile').count();
const spellIdx = (await page.locator('.tile').allTextContents()).findIndex((t) => t.includes('Spell it myself'));
await key('ArrowDown', spellIdx); await key(' ');
check(await page.isVisible('.spell'), `"Spell it myself" opens the board (${n} tiles)`);
// type "cold": rows are [predictions, ␣ETAOIN, SHRDLCU, MWFGYPB, VKJXQZ⌫, Done Cancel]
const type = async (row, col) => { await key('ArrowDown', row); await key(' '); await key('ArrowDown', col); await key(' '); };
await type(2, 5); // C
check((await page.textContent('.spell-text')).toLowerCase().includes('c'), 'row–column scanning types a letter');
const preds = await page.locator('.spell-row.pred .key').allTextContents();
const ci = preds.indexOf('cold');
check(ci >= 0, `word prediction offers "cold" after "c" (${preds.join(', ')})`);
await type(0, ci);
await type(5, 0); // Done
check((await page.textContent('.say-text')).includes('Cold'), 'spelled message reaches confirmation');
await page.screenshot({ path: 'e2e/out/5-spell-confirm.png' });
await key(' ');
await page.waitForTimeout(200);

// --- attention ---
await page.fill('#ask', 'hello');
await page.click('.ask button[type=submit]');
await page.mouse.click(5, 300);
const tiles = await page.locator('.tile').allTextContents();
await key('ArrowDown', tiles.findIndex((t) => t.includes('Get attention'))); await key(' ');
check(await page.isVisible('.attention'), 'attention screen shows');
await page.click('text=I\'m here');

// --- timeline + evaluate ---
await page.click('nav >> text=Timeline');
check((await page.textContent('.chart')).includes('7'), 'pain score charted on timeline');
await page.screenshot({ path: 'e2e/out/6-timeline.png', fullPage: true });
await axe('timeline');
await page.click('nav >> text=Evaluate');
await page.waitForSelector('table.eval');
await page.waitForTimeout(500);
await page.screenshot({ path: 'e2e/out/7-evaluate.png', fullPage: true });
await axe('evaluate');
await page.click('nav >> text=About'); await axe('about');
await page.click('text=Settings'); await page.waitForSelector('.settings'); await page.screenshot({ path: 'e2e/out/8-settings.png' }); await axe('settings');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close(); server.kill();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll end-to-end checks passed');
process.exit(failures ? 1 : 0);

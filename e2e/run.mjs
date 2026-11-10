// End-to-end test of the production build: first-time setup, a single-switch user completing
// a pain report, a spelled message and a help request, plus navigation, history, preferences,
// no evaluation UI in production, and axe WCAG 2.1 AA checks on every page.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(110); } };
const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur());
const axe = async (label) => {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  check(r.violations.length === 0, `axe WCAG 2.1 AA on ${label}: ${r.violations.map((v) => `${v.id}(${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')}`).join(', ') || 'no violations'}`);
};
const highlighted = () => page.textContent('.tile.on .tile-label');
const pickTile = async (label) => { // move the highlight with the switch until `label` is lit, then choose
  for (let i = 0; i < 20; i++) { if ((await highlighted())?.trim() === label) return key(' '); await key('ArrowDown'); }
  throw new Error(`tile not found: ${label}`);
};

await page.goto('http://localhost:4317/');
await page.evaluate(() => localStorage.clear());
await page.reload();

// ---- first visit: guided choice of input method ----
await page.waitForSelector('.onboard');
check(await page.isVisible('text=How will the patient choose?'), 'first visit asks how the patient will choose');
await page.screenshot({ path: 'e2e/out/0-welcome.png' });
await axe('welcome');
await page.click('text=With a button or key');
check(!(await page.isVisible('.onboard')), 'choosing a method closes the welcome');
check((await page.textContent('.status-pill')).includes('Using a button'), 'status pill explains the input method in plain words');
// slow scanning so the test controls the highlight
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('unspoken.v1')); s.settings.stepMs = 60000; s.settings.sounds = false; localStorage.setItem('unspoken.v1', JSON.stringify(s)); });
await page.reload(); await page.waitForSelector('.patient-zone');

// ---- navigation: no evaluation UI in production, no broken links ----
const navText = await page.textContent('nav');
check(['Talk', 'History', 'Preferences', 'About'].every((t) => navText.includes(t)) && !/Evaluat|Lab|Timeline/.test(navText), `navigation is Talk · History · Preferences · About (${navText.replace(/\s+/g, ' ')})`);
await page.goto('http://localhost:4317/#/lab'); await page.waitForTimeout(300);
check(await page.isVisible('.patient-zone') && !(await page.isVisible('text=Developer lab')), 'developer lab is not reachable in the production build');
await page.goto('http://localhost:4317/#/evaluate'); await page.waitForTimeout(300);
check(await page.isVisible('.patient-zone'), 'unknown or old routes fall back to Talk');
check(!(await page.content()).match(/Evaluate|False-selection|simulation/i), 'no evaluation wording anywhere in the app shell');
await page.goto('http://localhost:4317/#/talk'); await page.waitForSelector('.patient-zone');
await page.screenshot({ path: 'e2e/out/1-idle.png' });
await axe('Talk (idle)');

// ---- pain report, switch only ----
await page.fill('#ask', 'Are you in pain?');
await page.click('.ask-row button');
await blur();
check((await page.textContent('.ctx-text')).includes('Are you in pain'), 'the question is shown large on the patient side');
check((await highlighted()).includes('Yes, I am in pain'), 'first answer is highlighted');
check(await page.isVisible('.tile.on .tile-cta'), 'highlighted answer says how to choose it');
const actions = await page.locator('.board-actions .tile-label').allTextContents();
check(actions.join('|') === 'Spell a message|Something else|Get help', `fixed actions always present (${actions.join(', ')})`);
await page.screenshot({ path: 'e2e/out/2-answers.png' });
await key(' ');
check(await page.isVisible('.stepper li.now >> text=Where'), 'pain path shows progress: Where');
await page.screenshot({ path: 'e2e/out/3-where.png' });
await pickTile('Chest');
check(await page.isVisible('.stepper li.now >> text=How bad'), 'then: How bad');
await pickTile('Severe');
await pickTile('7');
check((await page.textContent('.confirm-text')).includes('My chest hurts. Pain 7 out of 10.'), 'confirmation shows the full sentence');
check((await highlighted()).includes('Yes, say it'), 'confirmation offers a clear yes');
await page.screenshot({ path: 'e2e/out/4-confirm.png' });
await key(' ');
await page.waitForTimeout(250);
check((await page.textContent('.said-card')).includes('My chest hurts. Pain 7 out of 10.'), 'caregiver sees "Patient said" card');
check((await page.textContent('.said-card')).includes('Pain report'), 'message is labelled by how it was chosen');
await page.screenshot({ path: 'e2e/out/5-said.png' });

// ---- cancel path: "No, go back" says nothing ----
await page.click('.quick >> text=Are you comfortable?');
await blur();
await pickTile('Yes');
await pickTile('No, go back');
check(await page.isVisible('.tile >> text=Spell a message') && (await page.locator('.history-none').count()) === 0, '"No, go back" returns to the answers');

// ---- spelling ----
await pickTile('Spell a message');
check(await page.isVisible('.spell'), 'spelling board opens');
const type = async (row, col) => { await key('ArrowDown', row); await key(' '); await key('ArrowDown', col); await key(' '); };
await type(2, 5); // C
const preds = await page.locator('.spell-row.pred .key').allTextContents();
check(preds.includes('cold'), `word suggestions after "c": ${preds.join(', ')}`);
await type(0, preds.indexOf('cold'));
await page.screenshot({ path: 'e2e/out/6-spell.png' });
await type(5, 0); // Done
check((await page.textContent('.confirm-text')).includes('Cold'), 'spelled message reaches confirmation');
await key(' ');
await page.waitForTimeout(200);
check((await page.textContent('.said-card')).includes('Spelled it'), 'spelled message labelled "Spelled it"');

// ---- get help ----
await pickTile('Get help');
check(await page.isVisible('.help-screen') && await page.isVisible('.cz-alert'), 'help shows on both patient and caregiver sides');
check((await page.textContent('.cz-alert')).includes('not a nurse call'), 'help clearly says it is not a nurse call');
await page.screenshot({ path: 'e2e/out/7-help.png' });
await page.click('.cz-alert button');

// ---- history ----
await page.click('nav >> text=History');
const hist = await page.textContent('main');
check(hist.includes('My chest hurts. Pain 7 out of 10.') && hist.includes('Cold'), 'history lists confirmed messages');
check(hist.includes('not a medical record'), 'history says it is not a medical record');
check(hist.includes('Pain the patient reported') && hist.includes('Chest'), 'pain reports summarised');
await page.screenshot({ path: 'e2e/out/8-history.png', fullPage: true });
await axe('History');

// ---- preferences: no AI / developer settings ----
await page.click('nav >> text=Preferences');
const prefs = await page.textContent('.prefs');
check(!/API key|\bmodel\b|provider|Groq|OpenAI|Anthropic|Gemini/i.test(prefs), 'preferences contain no AI or developer settings');
check(/How the patient chooses/.test(prefs) && /How fast/.test(prefs) && /Language and voice/.test(prefs), 'preferences cover method, speed, language and voice');
await page.click('.prefs >> text=Close eyes to choose');
check(await page.isVisible('.prefs >> #p-eyes') && await page.isVisible('.prefs >> text=Set up eye control'), 'choosing eyes offers eye setup');
await page.screenshot({ path: 'e2e/out/9-preferences.png', fullPage: true });
await axe('Preferences');
await page.click('.prefs >> text=Press a button or key');

// ---- about + hidden staff setup ----
await page.click('nav >> text=About');
await axe('About');
await page.click('text=Staff setup');
check(await page.isVisible('text=Smarter suggested answers'), 'staff setup reachable only from About');
await axe('Staff setup');

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close(); server.kill();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll end-to-end checks passed');
process.exit(failures ? 1 : 0);

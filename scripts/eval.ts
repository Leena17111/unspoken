/**
 * Reproducible offline evaluation. Writes docs/results/*.json and prints a Markdown summary.
 *   npm run eval
 * 1. Communication effort on 30 scripted exchanges (offline phrase set), vs letter-board baselines
 * 2. Ablation: number of suggestions shown (2/3/4) and scan speed
 * 3. Blink detection on simulated eye signals: Unspoken vs naive detectors
 * AI-suggestion results need an API key and are produced in the app (Evaluate → Run with AI).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { runEvaluation, DEFAULT_EFFORT, type EffortParams } from '../src/core/evaluation';
import { generateOptions, coreOptions, classifyQuestion } from '../src/core/options';
import { EyeSignalProcessor, calibrate, type FaceFrame } from '../src/core/eyeSignal';

const s = (ms: number) => (ms / 1000).toFixed(1) + ' s';
const pc = (x: number) => Math.round(x * 100) + '%';
mkdirSync('docs/results', { recursive: true });
const out: string[] = [];
const core = (q: string) => generateOptions(q, [], {}, { provider: 'none', apiKey: '' });

// ---------- 1. effort ----------
const base = await runEvaluation(core);
out.push('## 1. Communication effort (simulated, 30 scripted exchanges)\n');
out.push(`Parameters: ${s(DEFAULT_EFFORT.stepMs)} per scan step, ${s(DEFAULT_EFFORT.selectMs)} per deliberate blink, idealised user.\n`);
out.push('| Method | Avg. time / message | Avg. selections | Covered without spelling |\n|---|---|---|---|');
out.push(`| Letter-board scanning | ${s(base.mean.plain)} | ${base.meanSelections.plain.toFixed(1)} | 0% |`);
out.push(`| Letter board + word prediction | ${s(base.mean.predicted)} | ${base.meanSelections.predicted.toFixed(1)} | 0% |`);
out.push(`| **Unspoken (offline phrases)** | **${s(base.mean.unspoken)}** | **${base.meanSelections.unspoken.toFixed(1)}** | ${pc(base.coverage)} |`);
out.push(`\nUnspoken is ${pc(base.timeSavedVsPlain)} faster than conventional letter-board scanning and ${pc(base.timeSavedVsPredicted)} faster than a board with word prediction in this simulation.\n`);
const miss = base.results.filter((r) => !r.matched);
out.push(`Not covered by the offline phrases (fall back to spelling): ${miss.map((r) => `“${r.partner}” → “${r.target}”`).join('; ')}.\n`);
writeFileSync('docs/results/effort-offline.json', JSON.stringify(base, null, 2));

// ---------- 2. ablations ----------
out.push('## 2. Ablation: how many suggestions should a blink user see?\n');
out.push('More suggestions cover more messages, but every extra tile costs a scan step for every message.\n');
out.push('| Suggestions shown | Coverage | Avg. time / message |\n|---|---|---|');
for (const k of [1, 2, 3, 4]) {
  const r = await runEvaluation(async (q) => ({ options: coreOptions(classifyQuestion(q)).slice(0, k), latencyMs: 0, source: 'core' }));
  out.push(`| ${k} | ${pc(r.coverage)} | ${s(r.mean.unspoken)} |`);
}
out.push('\n### Sensitivity to scan speed\n');
out.push('| Scan step | Letter board | Unspoken | Time saved |\n|---|---|---|---|');
for (const step of [800, 1300, 2000]) {
  const p: EffortParams = { ...DEFAULT_EFFORT, stepMs: step };
  const r = await runEvaluation(core, p);
  out.push(`| ${s(step)} | ${s(r.mean.plain)} | ${s(r.mean.unspoken)} | ${pc(r.timeSavedVsPlain)} |`);
}

// ---------- 3. blink detection ----------
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
interface Sim { frames: FaceFrame[]; deliberate: { start: number; end: number }[]; natural: number }
/** 10 min of eye signal: natural blinks ~17/min (100–400 ms), 4 deliberate blinks/min (0.8–1.4 s), sensor noise. */
function simulate(minutes: number, noise: number, openLevel: number, closedLevel = 0.72, fps = 30): Sim {
  const frames: FaceFrame[] = []; const deliberate: { start: number; end: number }[] = []; let natural = 0;
  const T = minutes * 60000; const events: { start: number; dur: number; deliberate: boolean }[] = [];
  let t = 1000;
  while (t < T - 3000) {
    const gap = -Math.log(rnd()) * (60000 / 21); // ~21 closure events/min total
    t += Math.max(400, gap);
    const deliberateEv = rnd() < 4 / 21;
    const dur = deliberateEv ? 800 + rnd() * 600 : 100 + rnd() * 300;
    events.push({ start: t, dur, deliberate: deliberateEv }); t += dur + 300;
  }
  let ei = 0;
  for (let ft = 0; ft < T; ft += 1000 / fps) {
    while (ei < events.length && ft > events[ei].start + events[ei].dur + 60) ei++;
    const e = events[ei];
    let c = openLevel;
    if (e && ft >= e.start && ft <= e.start + e.dur) {
      const ramp = Math.min(1, (ft - e.start) / 60, (e.start + e.dur - ft) / 60); // ~60 ms lid travel
      c = openLevel + (closedLevel - openLevel) * Math.max(0, ramp);
    }
    c = Math.min(1, Math.max(0, c + gauss() * noise));
    frames.push({ t: ft, present: true, blinkL: c, blinkR: c, lookOutL: 0, lookInL: 0, lookOutR: 0, lookInR: 0 });
  }
  for (const e of events) { if (e.deliberate) deliberate.push({ start: e.start, end: e.start + e.dur }); else natural++; }
  return { frames, deliberate, natural };
}
function score(sim: Sim, selections: number[]) {
  const hit = new Set<number>(); let fp = 0;
  for (const t of selections) {
    const i = sim.deliberate.findIndex((d) => t >= d.start && t <= d.end + 400);
    if (i >= 0 && !hit.has(i)) hit.add(i); else fp++;
  }
  const minutes = (sim.frames[sim.frames.length - 1].t) / 60000;
  return { recall: hit.size / sim.deliberate.length, falsePerMin: fp / minutes };
}
const naive = (sim: Sim, thr: number, minMs = 0) => { // threshold on the raw signal, no smoothing / hysteresis / calibration
  const sel: number[] = []; let since = -1;
  for (const f of sim.frames) { const c = (f.blinkL + f.blinkR) / 2; if (since < 0 && c > thr) since = f.t; else if (since >= 0 && c <= thr) { if (f.t - since >= minMs) sel.push(f.t); since = -1; } }
  return sel;
};
const ours = (sim: Sim, calib: ReturnType<typeof calibrate>) => { const p = new EyeSignalProcessor(calib); const sel: number[] = []; for (const f of sim.frames) for (const e of p.push(f)) if (e.type === 'select') sel.push(e.t); return sel; };

out.push('\n## 3. Blink detection on simulated eye signals\n');
out.push('10 simulated minutes per condition: ~17 natural blinks/min (100–400 ms) and ~4 deliberate blinks/min (0.8–1.4 s), Gaussian sensor noise. Unspoken is calibrated on a separate 15 s recording (relaxed + eyes closed), exactly like the in-app wizard.\n');
out.push('| Condition | Detector | Deliberate blinks detected | False selections / min |\n|---|---|---|---|');
const rows: Record<string, unknown>[] = [];
for (const [label, noise, open, closedLvl = 0.72] of [['Typical (noise 0.04, open 0.08)', 0.04, 0.08], ['Noisy camera (noise 0.10)', 0.10, 0.08], ['Droopy eyelids (open 0.30)', 0.04, 0.30], ['Very droopy eyelids (open 0.48)', 0.04, 0.48], ['Very droopy + noisy (open 0.48, noise 0.08)', 0.08, 0.48], ['Weak eye closure (closed only 0.42; e.g. weak lids or glasses glare)', 0.04, 0.10, 0.42]] as [string, number, number, number?][]) {
  const sim = simulate(10, noise, open, closedLvl);
  const calSim = simulate(0.25, noise, open, closedLvl);
  const closedRec = simulate(0.05, noise, closedLvl, closedLvl).frames;
  const cal = calibrate({ relaxed: calSim.frames, closed: closedRec });
  const results = {
    'Naive: any blink selects': score(sim, naive(sim, 0.5)),
    'Naive + 550 ms minimum': score(sim, naive(sim, 0.5, 550)),
    'Unspoken (calibrated, smoothed, hysteresis)': score(sim, ours(sim, cal)),
  };
  for (const [d, r] of Object.entries(results)) out.push(`| ${label} | ${d} | ${pc(r.recall)} | ${r.falsePerMin.toFixed(2)} |`);
  rows.push({ label, noise, open, closed: closedLvl, selectMinMs: cal.selectMinMs, results });
}
writeFileSync('docs/results/blink-detection.json', JSON.stringify(rows, null, 2));
out.push('\nThese are simulated signals, used to compare detectors under controlled conditions. Real-world rates must be measured with the in-app 60-second false-selection test.\n');

const md = out.join('\n');
writeFileSync('docs/results/summary.md', md + '\n');
console.log(md);

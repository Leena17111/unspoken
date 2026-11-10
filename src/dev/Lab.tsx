/**
 * DEVELOPER LAB: evaluation tools for researchers and judges' reproducibility.
 * Only included in development builds (`npm run dev`, route #/lab). It is NOT part of the
 * public application: Vite removes it from production builds because it is imported behind
 * `import.meta.env.DEV`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Settings, TrialResult } from '../core/store';
import { PROVIDERS, generateOptions, type Provider } from '../core/options';
import { runEvaluation, SCENARIOS, type EvalSummary, DEFAULT_EFFORT } from '../core/evaluation';
import { EyeSignalProcessor, type Calibration } from '../core/eyeSignal';
import { frameBus } from '../ui/bus';
import { uid } from '../core/store';

function download(name: string, content: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
}

// ---------------- Evaluate ----------------
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function Lab({ settings, trials, onTrial, onStartMessageTrial }: {
  settings: Settings; trials: TrialResult[]; onTrial: (t: TrialResult) => void; onStartMessageTrial: (target: string, partner: string, method: 'unspoken' | 'spelling') => void;
}) {
  const [core, setCore] = useState<EvalSummary | null>(null);
  const [ai, setAi] = useState<EvalSummary | null>(null);
  const [running, setRunning] = useState(false);
  const p = { ...DEFAULT_EFFORT, stepMs: settings.stepMs, selectMs: Math.max(700, settings.calibration.selectMinMs + 300) };
  const aiOn = settings.ai.provider !== 'none' && !!settings.ai.apiKey;

  useEffect(() => { runEvaluation((q, h, c) => generateOptions(q, h, c, { provider: 'none', apiKey: '' }), p).then(setCore); }, [settings.stepMs, settings.calibration.selectMinMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const runAi = async () => { setRunning(true); setAi(await runEvaluation((q, h, c) => generateOptions(q, h, c, settings.ai), p)); setRunning(false); };

  return (
    <div className="page">
      <header className="page-head"><div><h1>Developer lab</h1><p>Two kinds of evidence, reported separately: a <b>simulation</b> of communication effort on 30 scripted exchanges, and <b>live trials</b> you run with the real camera.</p></div>
        <button onClick={() => download('unspoken-evaluation.json', JSON.stringify({ params: p, core, ai, trials }, null, 2))}>Download all results</button></header>

      <section className="panel">
        <h2>1 · Simulated communication effort</h2>
        <p className="muted">Idealised user (no mistakes), {secs(p.stepMs)} per scan step, {secs(p.selectMs)} per deliberate blink. A message counts as covered if one of the suggested replies conveys it; otherwise the simulated user picks “Spell it myself” and spells it with word prediction.</p>
        <table className="eval">
          <thead><tr><th scope="col">Method</th><th scope="col">Avg. time per message</th><th scope="col">Avg. selections</th><th scope="col">Covered without spelling</th><th scope="col">Median AI latency</th></tr></thead>
          <tbody>
            {core && <>
              <tr><td>Letter-board scanning (conventional)</td><td>{secs(core.mean.plain)}</td><td>{core.meanSelections.plain.toFixed(1)}</td><td>0%</td><td>–</td></tr>
              <tr><td>Letter board + word prediction</td><td>{secs(core.mean.predicted)}</td><td>{core.meanSelections.predicted.toFixed(1)}</td><td>0%</td><td>–</td></tr>
              <tr><td>Unspoken, offline phrases</td><td><b>{secs(core.mean.unspoken)}</b> <span className="good">−{pct(core.timeSavedVsPlain)}</span></td><td>{core.meanSelections.unspoken.toFixed(1)}</td><td>{pct(core.coverage)}</td><td>0 ms</td></tr>
            </>}
            {ai && <tr><td>Unspoken, AI ({settings.ai.model || PROVIDERS[settings.ai.provider as Exclude<Provider, 'none'>].model})</td><td><b>{secs(ai.mean.unspoken)}</b> <span className="good">−{pct(ai.timeSavedVsPlain)}</span></td><td>{ai.meanSelections.unspoken.toFixed(1)}</td><td>{pct(ai.coverage)}</td><td>{Math.round(ai.medianLatencyMs)} ms</td></tr>}
          </tbody>
        </table>
        <div className="actions">
          <button className="primary" onClick={runAi} disabled={!aiOn || running}>{running ? 'Running 30 scenarios…' : 'Run with AI suggestions'}</button>
          {!aiOn && <span className="muted">Add an AI key in Settings to compare.</span>}
        </div>
        {(ai || core) && (
          <details><summary>Per-scenario results ({(ai || core)!.results.filter((r) => r.matched).length}/{(ai || core)!.n} covered{ai ? ' by AI' : ''})</summary>
            <table className="eval small"><thead><tr><th>Caregiver says</th><th>Patient wants</th><th>Suggested replies</th><th>Covered</th></tr></thead>
              <tbody>{(ai || core)!.results.map((r) => <tr key={r.id}><td>{r.partner}</td><td>{r.target}</td><td>{r.options.join(' · ')}</td><td>{r.matched ? `#${r.matchIndex + 1}` : 'spell'}</td></tr>)}</tbody></table>
          </details>
        )}
      </section>

      <section className="panel">
        <h2>2 · Live trials with the camera</h2>
        <FalseActivationTest calibration={settings.calibration} onDone={onTrial} />
        <MessageTrialLauncher onStart={onStartMessageTrial} />
        <TrialTable trials={trials} />
      </section>
    </div>
  );
}

function FalseActivationTest({ calibration, onDone }: { calibration: Calibration; onDone: (t: TrialResult) => void }) {
  const [left, setLeft] = useState(0);
  const counts = useRef({ select: 0, ignored: 0 });
  const [, force] = useState(0);
  const start = () => {
    counts.current = { select: 0, ignored: 0 };
    const p = new EyeSignalProcessor(calibration);
    const off = frameBus.on((f) => { for (const e of p.push(f)) { if (e.type === 'select') counts.current.select++; if (e.type === 'blink-ignored') counts.current.ignored++; } force((x) => x + 1); });
    const end = Date.now() + 60000;
    const id = setInterval(() => {
      const l = Math.ceil((end - Date.now()) / 1000);
      setLeft(Math.max(0, l));
      if (l <= 0) { clearInterval(id); off(); onDone({ id: uid(), t: Date.now(), kind: 'false-activation', durationMs: 60000, falseSelections: counts.current.select, naturalBlinks: counts.current.ignored }); }
    }, 250);
    setLeft(60);
  };
  return (
    <div className="trial">
      <h3>False-selection test (60 s)</h3>
      <p className="muted">The person looks at the screen, reads, talks with their eyes as normal, <b>without trying to select</b>. Every selection counted here is a false activation.</p>
      {left > 0 ? <p className="live-count"><b>{left}s</b> · natural blinks ignored: {counts.current.ignored} · false selections: {counts.current.select}</p>
        : <button onClick={start}>Start 60-second test</button>}
    </div>
  );
}

function MessageTrialLauncher({ onStart }: { onStart: (target: string, partner: string, method: 'unspoken' | 'spelling') => void }) {
  const [sid, setSid] = useState('s03');
  const sc = SCENARIOS.find((s) => s.id === sid)!;
  return (
    <div className="trial">
      <h3>Message trial</h3>
      <p className="muted">Times a real message from the caregiver's question to the spoken reply. Run the same message once with Unspoken and once spelling-only.</p>
      <label className="field">Message<select value={sid} onChange={(e) => setSid(e.target.value)}>{SCENARIOS.map((s) => <option key={s.id} value={s.id}>“{s.partner}” → {s.target}</option>)}</select></label>
      <div className="actions"><button className="primary" onClick={() => onStart(sc.target, sc.partner, 'unspoken')}>Start with Unspoken</button><button onClick={() => onStart(sc.target, sc.partner, 'spelling')}>Start spelling-only</button></div>
    </div>
  );
}

function TrialTable({ trials }: { trials: TrialResult[] }) {
  const msg = trials.filter((t) => t.kind === 'message');
  const fa = trials.filter((t) => t.kind === 'false-activation');
  const avg = (m: 'unspoken' | 'spelling') => { const a = msg.filter((t) => t.method === m && t.ms); return a.length ? a.reduce((s, t) => s + t.ms!, 0) / a.length : null; };
  const summary = useMemo(() => ({ u: avg('unspoken'), s: avg('spelling') }), [trials]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!trials.length) return <p className="muted">No live trials recorded yet.</p>;
  return (
    <>
      {(summary.u || summary.s) && <p className="summary">Average live time per message: Unspoken <b>{summary.u ? secs(summary.u) : '–'}</b> · spelling-only <b>{summary.s ? secs(summary.s) : '–'}</b></p>}
      {fa.length > 0 && <p className="summary">False selections per minute: <b>{(fa.reduce((s, t) => s + (t.falseSelections || 0), 0) / fa.length).toFixed(2)}</b> (natural blinks ignored per minute: {(fa.reduce((s, t) => s + (t.naturalBlinks || 0), 0) / fa.length).toFixed(1)})</p>}
      <table className="eval small"><thead><tr><th>When</th><th>Trial</th><th>Result</th></tr></thead>
        <tbody>{[...trials].reverse().map((t) => <tr key={t.id}><td>{new Date(t.t).toLocaleTimeString()}</td>
          <td>{t.kind === 'message' ? `${t.method === 'unspoken' ? 'Unspoken' : 'Spelling-only'}: “${t.target}”` : '60 s false-selection test'}</td>
          <td>{t.kind === 'message' ? `${secs(t.ms || 0)}, ${t.selections} selections, said “${t.said}”${t.correct ? '' : ' (different from target)'}` : `${t.falseSelections} false selections, ${t.naturalBlinks} blinks ignored`}</td></tr>)}</tbody></table>
    </>
  );
}


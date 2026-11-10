import { useEffect, useMemo, useRef, useState } from 'react';
import type { Settings, LogEntry, TrialResult, InputMode } from '../core/store';
import { PROVIDERS, generateOptions, type Provider } from '../core/options';
import { runEvaluation, SCENARIOS, type EvalSummary, DEFAULT_EFFORT } from '../core/evaluation';
import { EyeSignalProcessor, type Calibration } from '../core/eyeSignal';
import { frameBus } from './bus';
import { uid } from '../core/store';

// ---------------- Settings ----------------
export function SettingsModal({ s, onChange, onClose, onClearData }: { s: Settings; onChange: (s: Settings) => void; onClose: () => void; onClearData: () => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  const preset = s.ai.provider !== 'none' ? PROVIDERS[s.ai.provider] : null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="set-title">
      <div className="modal settings">
        <h2 id="set-title">Settings</h2>
        <fieldset>
          <legend>How the patient selects</legend>
          {([['eyes-scan', 'Long blink + automatic scanning', 'The highlight moves by itself; a long blink chooses. Needs only one reliable movement.'],
            ['eyes-gaze', 'Glance left/right + long blink', 'Faster if the patient can move their eyes sideways.'],
            ['switch', 'Single switch / key only', 'Any key (Space) or an adapted switch chooses. Camera not used for input.']] as [InputMode, string, string][]).map(([v, l, d]) => (
            <label key={v} className="radio"><input type="radio" name="mode" checked={s.inputMode === v} onChange={() => set({ inputMode: v })} /><span><b>{l}</b><small>{d}</small></span></label>
          ))}
          <label className="field">Scan speed: {(s.stepMs / 1000).toFixed(1)} s per item
            <input type="range" min={600} max={3000} step={100} value={s.stepMs} onChange={(e) => set({ stepMs: Number(e.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={s.showVideo} onChange={(e) => set({ showVideo: e.target.checked })} /> Show camera preview (video never leaves this device)</label>
          <label className="check"><input type="checkbox" checked={s.sounds} onChange={(e) => set({ sounds: e.target.checked })} /> Audio feedback for selections</label>
        </fieldset>
        <fieldset>
          <legend>AI reply suggestions</legend>
          <p className="hint">Optional. Without a key, Unspoken uses its built-in offline phrase set. Your key is stored only in this browser and sent only to the provider you choose.</p>
          <label className="field">Provider
            <select value={s.ai.provider} onChange={(e) => set({ ai: { ...s.ai, provider: e.target.value as Provider, model: '' } })}>
              <option value="none">Off: offline phrases only</option>
              {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select></label>
          {s.ai.provider !== 'none' && (
            <>
              <label className="field">API key<input type="password" value={s.ai.apiKey} placeholder={preset?.keyHint} onChange={(e) => set({ ai: { ...s.ai, apiKey: e.target.value.trim() } })} autoComplete="off" /></label>
              <label className="field">Model<input value={s.ai.model || ''} placeholder={preset?.model} onChange={(e) => set({ ai: { ...s.ai, model: e.target.value.trim() } })} /></label>
              {s.ai.provider === 'custom' && <label className="field">Base URL<input value={s.ai.baseUrl || ''} placeholder="https://…/v1" onChange={(e) => set({ ai: { ...s.ai, baseUrl: e.target.value.trim() } })} /></label>}
            </>
          )}
        </fieldset>
        <fieldset>
          <legend>Patient & voice</legend>
          <label className="field">Care context for the AI (no names or medical record numbers)<textarea rows={2} value={s.patient.notes} placeholder="e.g. Intubated after surgery, alert, prefers short answers" onChange={(e) => set({ patient: { ...s.patient, notes: e.target.value } })} /></label>
          <label className="field">Language for replies & voice
            <select value={s.voiceLang} onChange={(e) => set({ voiceLang: e.target.value, listenLang: e.target.value, patient: { ...s.patient, language: e.target.options[e.target.selectedIndex].text } })}>
              <option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="ms-MY">Bahasa Melayu</option><option value="zh-CN">中文 (Mandarin)</option><option value="ta-IN">தமிழ் (Tamil)</option>
            </select></label>
        </fieldset>
        <div className="actions"><button className="primary" onClick={onClose}>Done</button><button className="danger" onClick={onClearData}>Clear conversation & trial data</button></div>
      </div>
    </div>
  );
}

// ---------------- Timeline (clinician view) ----------------
export function Timeline({ log }: { log: LogEntry[] }) {
  const pain = log.filter((e) => e.meta?.painScore != null);
  const patient = log.filter((e) => e.kind === 'patient');
  const w = 640, h = 180, pad = 28;
  const t0 = pain[0]?.t ?? 0, t1 = pain[pain.length - 1]?.t ?? 1;
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (w - 2 * pad);
  const y = (v: number) => h - pad - (v / 10) * (h - 2 * pad);
  const exportCsv = () => {
    const rows = [['time', 'speaker', 'message', 'source', 'selections', 'seconds', 'pain', 'location'], ...log.map((e) => [new Date(e.t).toISOString(), e.kind, e.text, e.meta?.source || '', e.meta?.selections ?? '', e.meta?.elapsedMs ? (e.meta.elapsedMs / 1000).toFixed(1) : '', e.meta?.painScore ?? '', e.meta?.painLocation || ''])];
    download('unspoken-timeline.csv', rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  };
  const avgSel = patient.filter((e) => e.meta?.selections != null).map((e) => e.meta!.selections!);
  return (
    <div className="view">
      <header className="view-head"><div><h1>Timeline</h1><p>What the patient communicated during this session, for handover to the next shift.</p></div><button onClick={exportCsv} disabled={!log.length}>Export CSV</button></header>
      <div className="stats">
        <div><b>{patient.length}</b><span>patient messages</span></div>
        <div><b>{avgSel.length ? (avgSel.reduce((a, b) => a + b, 0) / avgSel.length).toFixed(1) : '–'}</b><span>selections per message (avg)</span></div>
        <div><b>{patient.filter((e) => e.meta?.source === 'ai').length}</b><span>said with an AI suggestion</span></div>
        <div><b>{patient.filter((e) => e.meta?.source === 'spelled').length}</b><span>spelled independently</span></div>
      </div>
      <section className="card">
        <h2>Pain reports</h2>
        {pain.length === 0 ? <p className="muted">No pain scores reported yet. When the patient answers a pain question, the score and location appear here.</p> : (
          <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label={`Pain scores over time: ${pain.map((p) => p.meta!.painScore).join(', ')}`}>
            {[0, 5, 10].map((v) => <g key={v}><line x1={pad} x2={w - pad} y1={y(v)} y2={y(v)} className="grid" /><text x={6} y={y(v) + 4}>{v}</text></g>)}
            <polyline points={pain.map((p) => `${x(p.t)},${y(p.meta!.painScore!)}`).join(' ')} className="line" />
            {pain.map((p) => <g key={p.id}><circle cx={x(p.t)} cy={y(p.meta!.painScore!)} r={5} /><text x={x(p.t)} y={y(p.meta!.painScore!) - 10} textAnchor="middle">{p.meta!.painScore} {p.meta!.painLocation || ''}</text></g>)}
          </svg>
        )}
      </section>
      <section className="card">
        <h2>Conversation</h2>
        <ol className="tl">
          {log.length === 0 && <li className="muted">Nothing yet.</li>}
          {log.map((e) => (
            <li key={e.id} className={`kind-${e.kind}`}>
              <time>{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              <span className="who">{e.kind === 'partner' ? 'Caregiver' : e.kind === 'patient' ? 'Patient' : e.kind === 'attention' ? 'Attention' : 'System'}</span>
              <span className="msg">{e.text}</span>
              {e.meta && <span className="meta">{[e.meta.source, e.meta.model, e.meta.latencyMs != null ? `${Math.round(e.meta.latencyMs)} ms` : '', e.meta.selections != null ? `${e.meta.selections} sel.` : '', e.meta.elapsedMs != null ? `${(e.meta.elapsedMs / 1000).toFixed(1)} s` : ''].filter(Boolean).join(' · ')}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function download(name: string, content: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
}

// ---------------- Evaluate ----------------
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Evaluate({ settings, trials, onTrial, onStartMessageTrial }: {
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
    <div className="view">
      <header className="view-head"><div><h1>Evaluation</h1><p>Two kinds of evidence, reported separately: a <b>simulation</b> of communication effort on 30 scripted exchanges, and <b>live trials</b> you run with the real camera.</p></div>
        <button onClick={() => download('unspoken-evaluation.json', JSON.stringify({ params: p, core, ai, trials }, null, 2))}>Download all results</button></header>

      <section className="card">
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

      <section className="card">
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

// ---------------- About ----------------
export function About() {
  return (
    <div className="view about">
      <header className="view-head"><div><h1>About Unspoken</h1><p>An awake patient who cannot speak should not have to spell every word with their eyes.</p></div></header>
      <section className="card prose">
        <h2>The problem</h2>
        <p>Patients on a ventilator, after a stroke, or living with motor neurone disease are often fully aware but unable to speak or write. Today they communicate with yes/no questions, laminated letter boards, or specialised eye-tracking hardware that many hospitals don’t have. Spelling a sentence letter by letter takes minutes, so important messages like pain, fear or thirst often go unsaid.</p>
        <h2>How Unspoken works</h2>
        <ol>
          <li><b>Eyes as input, on an ordinary webcam.</b> MediaPipe face tracking runs in the browser. Unspoken’s signal processing, calibrated to each person, separates a deliberate long blink from natural blinking, with live “hold” feedback and audio cues that work with eyes closed.</li>
          <li><b>Conversation-aware suggestions.</b> When the caregiver speaks, Unspoken suggests a few short replies the patient is most likely to want, so a full sentence takes a few selections instead of dozens.</li>
          <li><b>The patient stays in control.</b> “Spell it myself” and “None of these” are always available, nothing is spoken until the patient confirms, and suggestions are checked by rules: yes/no questions always get both answers, and treatment decisions are never suggested.</li>
          <li><b>Structured pain reporting</b> (location + 0–10 score) feeds a timeline for the next shift.</li>
        </ol>
        <h2>What it is not</h2>
        <p>Unspoken is a research prototype. It has not been tested with patients, it is not a medical device, and the “Get attention” button is <b>not a replacement for a nurse-call system</b> or monitoring. Performance depends on lighting, camera position and the patient’s ability to blink deliberately.</p>
        <h2>Privacy</h2>
        <p>Video is processed on this device and never uploaded. Conversation data stays in this browser. If you enable AI suggestions, only the caregiver’s question, recent conversation text and your care-context note are sent to the provider you choose.</p>
      </section>
    </div>
  );
}

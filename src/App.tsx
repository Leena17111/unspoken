import { useCallback, useEffect, useRef, useState } from 'react';
import { EyeSignalProcessor, type Calibration } from './core/eyeSignal';
import { FaceTracker, type CameraStatus } from './core/camera';
import { PartnerListener, speak, beep } from './core/speech';
import { generateOptions, coreOptions, FIXED_OPTIONS, classifyQuestion, PROVIDERS, type ReplyOption, type Turn, type Provider } from './core/options';
import { SCENARIOS } from './core/evaluation';
import { load, save, uid, type Settings, type LogEntry, type TrialResult } from './core/store';
import { inputBus, eyeStore, frameBus, effort } from './ui/bus';
import { ScanBoard, SpellBoard, type Tile } from './ui/Boards';
import { EyeMonitor, PartnerPanel } from './ui/Panels';
import { CalibrationWizard } from './ui/Calibration';
import { SettingsModal, Timeline, Evaluate, About } from './ui/Views';

type Screen =
  | { name: 'reply' }
  | { name: 'menu' }
  | { name: 'confirm'; text: string; source: NonNullable<LogEntry['meta']>['source']; pain?: { score: number; location: string } }
  | { name: 'spell'; initial?: string }
  | { name: 'location'; prefix: string }
  | { name: 'pain'; location: string }
  | { name: 'painExact'; location: string; band: [number, number] }
  | { name: 'attention' };

type View = 'talk' | 'timeline' | 'evaluate' | 'about';
interface Trial { target: string; partner: string; method: 'unspoken' | 'spelling'; start: number }

const BODY = ['Throat / tube', 'Chest', 'Back', 'Head', 'Stomach', 'Arms', 'Legs', 'Mouth'];
const BODY_RE = /\b(throat|tube|chest|back|head|stomach|belly|arm|arms|leg|legs|mouth|neck|shoulder|hip|feet|foot|hand)\b/i;
const BANDS: [string, [number, number]][] = [['Mild (1–3)', [1, 3]], ['Moderate (4–6)', [4, 6]], ['Severe (7–8)', [7, 8]], ['Worst (9–10)', [9, 10]]];

export default function App() {
  const initial = useRef(load());
  const [settings, setSettings] = useState<Settings>(initial.current.settings);
  const [log, setLog] = useState<LogEntry[]>(initial.current.log);
  const [trials, setTrials] = useState<TrialResult[]>(initial.current.trials);
  const [view, setView] = useState<View>('talk');
  const [modal, setModal] = useState<null | 'settings' | 'calibrate'>(null);
  const [cam, setCam] = useState<{ status: CameraStatus; msg?: string }>({ status: 'off' });
  const [fps, setFps] = useState(0);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState<string>();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<ReplyOption[]>(coreOptions('open'));
  const [gen, setGen] = useState<{ source: string; latencyMs?: number; model?: string; note?: string }>({ source: 'core' });
  const [thinking, setThinking] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'reply' });
  const [boardKey, setBoardKey] = useState(0);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [toast, setToast] = useState('');
  const msgStart = useRef(performance.now());

  const videoRef = useRef<HTMLVideoElement>(null);
  const proc = useRef(new EyeSignalProcessor(settings.calibration, { gazeEnabled: settings.inputMode === 'eyes-gaze' }));
  const tracker = useRef<FaceTracker | null>(null);
  const listener = useRef<PartnerListener | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const logRef = useRef(log); logRef.current = log;
  const questionId = useRef(0);

  // persist
  useEffect(() => { save({ settings, log, trials }); }, [settings, log, trials]);
  useEffect(() => {
    proc.current.setCalibration(settings.calibration);
    proc.current.setOptions({ gazeEnabled: settings.inputMode === 'eyes-gaze' });
  }, [settings.calibration, settings.inputMode]);

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 3500); };
  const addLog = useCallback((e: Omit<LogEntry, 'id' | 't'>) => setLog((l) => [...l, { ...e, id: uid(), t: Date.now() }]), []);

  // ---------- camera → signal processing → input events ----------
  const startCamera = useCallback(() => {
    if (!videoRef.current) return;
    if (!tracker.current) {
      let lastUi = 0;
      tracker.current = new FaceTracker((f) => {
        frameBus.emit(f);
        const events = proc.current.push(f);
        if (f.t - lastUi > 50) { eyeStore.set(proc.current.state); lastUi = f.t; }
        const mode = settingsRef.current.inputMode;
        if (mode === 'switch') return;
        for (const e of events) {
          if (e.type === 'select') inputBus.emit('select', 'eyes');
          else if (e.type === 'gaze' && mode === 'eyes-gaze') inputBus.emit(e.dir === 'right' ? 'next' : 'prev', 'eyes');
        }
      }, (status, msg) => setCam({ status, msg }));
    }
    tracker.current.start(videoRef.current);
  }, []);
  useEffect(() => { if (settings.cameraOn) startCamera(); return () => tracker.current?.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = setInterval(() => setFps(tracker.current?.fps || 0), 1000); return () => clearInterval(id); }, []);

  // ---------- keyboard / single switch ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== 'talk' || modal) return;
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) inputBus.emit('select', 'switch'); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); inputBus.emit('next', 'switch'); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); inputBus.emit('prev', 'switch'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, modal]);

  const go = (s: Screen) => { setScreen(s); setBoardKey((k) => k + 1); };
  const resetEffort = () => { effort.reset(); msgStart.current = performance.now(); };

  // ---------- caregiver asks something ----------
  const ask = useCallback(async (q: string) => {
    const id = ++questionId.current;
    const history: Turn[] = logRef.current.filter((e) => e.kind === 'partner' || e.kind === 'patient').slice(-8).map((e) => ({ speaker: e.kind === 'partner' ? 'partner' : 'patient', text: e.text, t: e.t }));
    addLog({ kind: 'partner', text: q });
    setQuestion(q);
    const qt = classifyQuestion(q);
    setOptions(coreOptions(qt)); setGen({ source: 'core' });
    go({ name: 'reply' });
    resetEffort();
    const s = settingsRef.current;
    if (s.ai.provider === 'none' || !s.ai.apiKey) return;
    setThinking(true);
    const shownAt = effort.selections;
    const r = await generateOptions(q, history, { notes: s.patient.notes, language: s.patient.language }, s.ai);
    setThinking(false);
    if (id !== questionId.current) return; // a newer question arrived
    if (r.source === 'ai' && effort.selections === shownAt) { setOptions(r.options); setBoardKey((k) => k + 1); }
    setGen({ source: r.source, latencyMs: r.latencyMs, model: r.model, note: r.note });
  }, [addLog]);

  const toggleMic = () => {
    if (listening) { listener.current?.stop(); return; }
    setMicError(undefined);
    listener.current = new PartnerListener(setInterim, (t) => { setInterim(''); ask(t); }, (on, err) => { setListening(on); if (err) setMicError(err); });
    listener.current.start(settings.listenLang);
  };

  // ---------- patient choices ----------
  const choose = (o: ReplyOption) => {
    if (o.id === 'fixed-spell') return go({ name: 'spell' });
    if (o.id === 'fixed-none') return go({ name: 'menu' });
    if (o.id === 'attention') return raiseAttention();
    const isPain = /^pain-(yes|little|worse)/.test(o.intent) || (/\b(pain|hurt|hurts|sore|aching)\b/i.test(o.text) && !/^(no|not)\b/i.test(o.text));
    if (isPain) {
      const loc = BODY_RE.exec(o.text)?.[1];
      return loc ? go({ name: 'pain', location: loc.toLowerCase() }) : go({ name: 'location', prefix: o.text });
    }
    go({ name: 'confirm', text: o.text, source: o.source === 'ai' ? 'ai' : 'core' });
  };

  const raiseAttention = () => {
    addLog({ kind: 'attention', text: 'Patient asked for attention' });
    go({ name: 'attention' });
  };
  useEffect(() => {
    if (screen.name !== 'attention') return;
    beep(880, 300, 0.25);
    const id = setInterval(() => beep(880, 300, 0.25), 2000);
    return () => clearInterval(id);
  }, [screen.name]);

  const sayIt = async (text: string, source: NonNullable<LogEntry['meta']>['source'], pain?: { score: number; location: string }) => {
    const elapsedMs = performance.now() - msgStart.current;
    const selections = effort.selections;
    addLog({ kind: 'patient', text, meta: { source, selections, elapsedMs, latencyMs: source === 'ai' ? gen.latencyMs : undefined, model: source === 'ai' ? gen.model : undefined, painScore: pain?.score, painLocation: pain?.location } });
    if (trial) {
      const sc = SCENARIOS.find((s) => s.target === trial.target);
      const correct = sc ? sc.accept.test(text) || text.toLowerCase().includes(trial.target.toLowerCase()) : true;
      setTrials((t) => [...t, { id: uid(), t: Date.now(), kind: 'message', method: trial.method, target: trial.target, said: text, ms: performance.now() - trial.start, selections, correct }]);
      setTrial(null);
      flash(`Trial recorded: ${(elapsedMs / 1000).toFixed(1)} s, ${selections} selections`);
    }
    setQuestion(''); setOptions(coreOptions('open')); setGen({ source: 'core' });
    go({ name: 'reply' });
    resetEffort();
    await speak(text, settings.voiceLang);
  };

  const startTrial = (target: string, partner: string, method: 'unspoken' | 'spelling') => {
    setView('talk');
    setTrial({ target, partner, method, start: performance.now() });
    if (method === 'unspoken') ask(partner);
    else { addLog({ kind: 'partner', text: partner }); setQuestion(partner); go({ name: 'spell' }); resetEffort(); }
    // ensure the trial clock starts when the question appears
    setTimeout(() => setTrial((t) => (t ? { ...t, start: performance.now() } : t)), 0);
  };

  // ---------- screens ----------
  const mode = settings.inputMode === 'eyes-gaze' ? 'gaze' as const : 'scan' as const;
  const board = (items: Tile[], onSelect: (i: number) => void, label: string, layout: 'list' | 'grid' | 'scale' = 'list') =>
    <ScanBoard key={boardKey} items={items} onSelect={onSelect} mode={mode} stepMs={settings.stepMs} layout={layout} sounds={settings.sounds} label={label} />;
  const ATTN: Tile = { key: 'attention', label: 'Get attention', sub: 'plays a chime', tone: 'danger' };

  let patientUi: JSX.Element;
  switch (screen.name) {
    case 'reply': {
      const all = [...options, ...FIXED_OPTIONS];
      patientUi = board([...all.map((o) => ({ key: o.id, label: o.text, tone: o.source } as Tile)), ATTN],
        (i) => (i === all.length ? raiseAttention() : choose(all[i])), 'Reply options');
      break;
    }
    case 'menu': {
      const items: [string, () => void][] = [
        ['Yes', () => go({ name: 'confirm', text: 'Yes', source: 'core' })],
        ['No', () => go({ name: 'confirm', text: 'No', source: 'core' })],
        ['I am in pain', () => go({ name: 'location', prefix: 'I am in pain' })],
        ['I need something', () => { setOptions(coreOptions('need')); go({ name: 'reply' }); }],
        ['I am scared', () => go({ name: 'confirm', text: 'I am scared', source: 'core' })],
        ['Please wait, ask me later', () => go({ name: 'confirm', text: 'Please wait, ask me later', source: 'core' })],
        ['Spell it myself', () => go({ name: 'spell' })],
        ['Back', () => go({ name: 'reply' })],
      ];
      patientUi = board([...items.map(([l], i) => ({ key: `m${i}`, label: l, tone: l === 'Spell it myself' || l === 'Back' ? 'fixed' : 'core' } as Tile)), ATTN],
        (i) => (i === items.length ? raiseAttention() : items[i][1]()), 'Other things to say');
      break;
    }
    case 'location': {
      const items = [...BODY, 'Somewhere else (spell)', 'Back'];
      patientUi = board(items.map((l, i) => ({ key: `l${i}`, label: l, tone: i >= BODY.length ? 'fixed' : 'core' })),
        (i) => i === BODY.length + 1 ? go({ name: 'reply' }) : i === BODY.length ? go({ name: 'spell', initial: 'my ' }) : go({ name: 'pain', location: BODY[i].split(' ')[0].toLowerCase() }), 'Where is the pain?', 'grid');
      break;
    }
    case 'pain': {
      const loc = screen.location;
      const items = [...BANDS.map(([l]) => l), 'Skip the number'];
      patientUi = board(items.map((l, i) => ({ key: `p${i}`, label: l, tone: i === BANDS.length ? 'fixed' : 'core' })),
        (i) => i === BANDS.length ? go({ name: 'confirm', text: `My ${loc} hurts.`, source: 'structured' }) : go({ name: 'painExact', location: loc, band: BANDS[i][1] }), 'How bad is the pain?', 'scale');
      break;
    }
    case 'painExact': {
      const [a, b] = screen.band; const loc = screen.location;
      const nums = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      patientUi = board([...nums.map((n) => ({ key: `n${n}`, label: String(n), sub: 'out of 10', tone: 'core' } as Tile)), { key: 'back', label: 'Back', tone: 'fixed' }],
        (i) => i === nums.length ? go({ name: 'pain', location: loc }) : go({ name: 'confirm', text: `My ${loc} hurts. Pain ${nums[i]} out of 10.`, source: 'structured', pain: { score: nums[i], location: loc } }), 'Pain score', 'scale');
      break;
    }
    case 'confirm': {
      const s = screen;
      patientUi = (
        <div className="confirm">
          <p className="say-label">Say this?</p>
          <p className="say-text">“{s.text}”</p>
          {board([{ key: 'say', label: 'Say it', tone: 'primary' }, { key: 'edit', label: 'Change it', tone: 'fixed' }, { key: 'cancel', label: 'Cancel', tone: 'quiet' }],
            (i) => i === 0 ? sayIt(s.text, s.source, s.pain) : i === 1 ? go({ name: 'spell', initial: s.text.toLowerCase().replace(/[.]/g, '') + ' ' }) : go({ name: 'reply' }), 'Confirm message', 'grid')}
        </div>
      );
      break;
    }
    case 'spell':
      patientUi = <SpellBoard key={boardKey} mode={mode} stepMs={settings.stepMs} sounds={settings.sounds} initial={screen.initial}
        onDone={(t) => go({ name: 'confirm', text: t, source: 'spelled' })} onCancel={() => go({ name: 'reply' })} />;
      break;
    case 'attention':
      patientUi = (
        <div className="attention" role="alert">
          <p className="attn-title">The patient is asking for attention</p>
          <p>This is a chime, not a nurse call. Use the bed's call button for emergencies.</p>
          <button className="primary big" onClick={() => { addLog({ kind: 'system', text: 'Caregiver responded' }); go({ name: 'reply' }); }}>I'm here</button>
          {board([{ key: 'stop', label: 'Stop the chime', tone: 'fixed' }], () => go({ name: 'reply' }), 'Attention')}
        </div>
      );
      break;
  }

  const hint = settings.inputMode === 'switch' ? 'Press Space (or your switch) when your choice is highlighted'
    : settings.inputMode === 'eyes-gaze' ? 'Glance left or right to move · close your eyes for a moment to choose'
    : 'Close your eyes for a moment when your choice is highlighted';
  const aiLabel = settings.ai.provider === 'none' || !settings.ai.apiKey ? 'Offline phrases' : (PROVIDERS[settings.ai.provider as Exclude<Provider, 'none'>]?.label.split(' (')[0] || 'AI');
  const camOk = cam.status === 'running';

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to main content</a>
      <header className="top">
        <div className="brand"><svg className="mark" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#172026"/><circle cx="16" cy="16" r="8" fill="none" stroke="#f2c14e" strokeWidth="3"/><path d="M16 8a8 8 0 0 1 0 16z" fill="#f2c14e"/></svg><span>Unspoken</span></div>
        <nav aria-label="Main">
          {(['talk', 'timeline', 'evaluate', 'about'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>{{ talk: 'Talk', timeline: 'Timeline', evaluate: 'Evaluate', about: 'About' }[v]}</button>
          ))}
        </nav>
        <div className="status">
          <button className={`chip ${camOk ? 'ok' : 'warn'}`} onClick={() => (camOk ? undefined : startCamera())} title="Camera status">{camOk ? 'Camera on' : cam.status === 'loading' ? 'Starting camera…' : 'Start camera'}</button>
          <span className="chip">{settings.inputMode === 'switch' ? 'Switch input' : settings.inputMode === 'eyes-gaze' ? 'Gaze + blink' : 'Blink scanning'}</span>
          <span className={`chip ${aiLabel === 'Offline phrases' ? '' : 'ai'}`}>{aiLabel}</span>
          <button className="ghost" onClick={() => setModal('calibrate')}>Calibrate</button>
          <button className="ghost" onClick={() => setModal('settings')}>Settings</button>
        </div>
      </header>

      <main id="main" className={`main view-${view}`}>
        <div className="talk" hidden={view !== 'talk'}>
          <section className="patient" aria-label="Patient screen">
            {!settings.calibration.calibrated && settings.inputMode !== 'switch' && (
              <div className="banner">Eye input is using default settings. <button onClick={() => setModal('calibrate')}>Calibrate for this person (20 s)</button></div>
            )}
            {trial && <div className="banner trial">Trial ({trial.method === 'unspoken' ? 'Unspoken' : 'spelling only'}): say <b>“{trial.target}”</b> <button onClick={() => setTrial(null)}>Stop trial</button></div>}
            <div className="heard">
              <span className="heard-label">{question ? 'Caregiver said' : 'Waiting for the caregiver'}</span>
              <p className="heard-text">{question ? `“${question}”` : 'You can also start a message yourself.'}</p>
              {screen.name === 'reply' && <span className={`src ${gen.source}`}>{thinking ? 'Suggesting replies…' : gen.source === 'ai' ? `AI suggestions · ${Math.round(gen.latencyMs || 0)} ms` : question ? 'Quick replies' : 'Common phrases'}</span>}
            </div>
            <div className="screen">{patientUi}</div>
            <p className="scan-hint" aria-live="polite">{hint}</p>
          </section>
          <div className="side">
            <EyeMonitor videoRef={videoRef} status={cam.status} statusMsg={cam.msg} showVideo={settings.showVideo} fps={fps} mode={settings.inputMode} />
            <PartnerPanel listening={listening} interim={interim} onToggleMic={toggleMic} onAsk={ask} log={log} micError={micError} thinking={thinking} />
          </div>
        </div>
        {view === 'timeline' && <Timeline log={log} />}
        {view === 'evaluate' && <Evaluate settings={settings} trials={trials} onTrial={(t) => setTrials((x) => [...x, t])} onStartMessageTrial={startTrial} />}
        {view === 'about' && <About />}
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
      {modal === 'settings' && <SettingsModal s={settings} onChange={setSettings} onClose={() => setModal(null)} onClearData={() => { setLog([]); setTrials([]); flash('Conversation and trial data cleared'); }} />}
      {modal === 'calibrate' && <CalibrationWizard cameraReady={camOk} onClose={() => setModal(null)}
        onSave={(c: Calibration) => { setSettings((s) => ({ ...s, calibration: { openClosure: c.openClosure, closedClosure: c.closedClosure, selectMinMs: c.selectMinMs, gazeNeutral: c.gazeNeutral, gazeSpan: c.gazeSpan, calibrated: true } })); setModal(null); flash('Calibration saved'); }} />}
    </div>
  );
}



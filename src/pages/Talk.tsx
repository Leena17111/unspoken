import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { generateOptions, coreOptions, classifyQuestion, type ReplyOption, type Turn } from '../core/options';
import { PartnerListener, speak, beep } from '../core/speech';
import type { CameraStatus } from '../core/camera';
import type { LogEntry, Settings } from '../core/store';
import { effort, useEye } from '../ui/bus';
import { ScanBoard, SpellBoard, chooseHint, type Tile } from '../ui/Boards';

type Source = NonNullable<LogEntry['meta']>['source'];
type Screen =
  | { name: 'choices' }
  | { name: 'more' }
  | { name: 'where' }
  | { name: 'severity'; location: string }
  | { name: 'score'; location: string; band: [number, number] }
  | { name: 'confirm'; text: string; source: Source; pain?: { score: number; location: string }; from: 'choices' | 'pain' | 'spell' }
  | { name: 'spell'; initial?: string }
  | { name: 'help' };

export interface PendingTrial { target: string; partner: string; method: 'unspoken' | 'spelling'; nonce: number }

const BODY: [string, string][] = [['Throat / tube', 'throat'], ['Chest', 'chest'], ['Head', 'head'], ['Stomach', 'stomach'], ['Back', 'back'], ['Arms', 'arm'], ['Legs', 'leg'], ['Mouth', 'mouth']];
const BODY_RE = /\b(throat|tube|chest|back|head|stomach|belly|arm|arms|leg|legs|mouth|neck|shoulder|hip|feet|foot|hand)\b/i;
const BANDS: [string, string, [number, number]][] = [['A little', '1 to 3', [1, 3]], ['Moderate', '4 to 6', [4, 6]], ['Severe', '7 or 8', [7, 8]], ['The worst', '9 or 10', [9, 10]]];
const QUICK = ['Are you in pain?', 'Do you need anything?', 'Are you comfortable?', 'How are you feeling?', 'Do you want me to call your family?'];

const toneOf = (text: string): Tile['tone'] => (/^(yes|yeah|ya)\b/i.test(text) ? 'yes' : /^(no|not)\b/i.test(text) ? 'no' : 'answer');

interface Props {
  settings: Settings;
  log: LogEntry[];
  addLog: (e: Omit<LogEntry, 'id' | 't'>) => void;
  cam: { status: CameraStatus; msg?: string };
  fps: number;
  videoRef: RefObject<HTMLVideoElement>;
  onStartCamera: () => void;
  onSetupEyes: () => void;
  onChooseMethod: (m: Settings['inputMode']) => void;
  goHistory: () => void;
  active: boolean;
  pendingTrial: PendingTrial | null;
  onTrialDone: (r: { method: 'unspoken' | 'spelling'; target: string; said: string; ms: number; selections: number }) => void;
}

export function Talk(p: Props) {
  const { settings } = p;
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<ReplyOption[]>(coreOptions('open'));
  const [gen, setGen] = useState<{ source: string; latencyMs?: number; model?: string }>({ source: 'core' });
  const [thinking, setThinking] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'choices' });
  const [boardKey, setBoardKey] = useState(0);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState<string>();
  const [typed, setTyped] = useState('');
  const [trial, setTrial] = useState<(PendingTrial & { start: number }) | null>(null);
  const msgStart = useRef(performance.now());
  const listener = useRef<PartnerListener | null>(null);
  const qid = useRef(0);
  const logRef = useRef(p.log); logRef.current = p.log;
  const settingsRef = useRef(settings); settingsRef.current = settings;

  const go = (s: Screen) => { setScreen(s); setBoardKey((k) => k + 1); };
  const resetEffort = () => { effort.reset(); msgStart.current = performance.now(); };

  // ---------- caregiver asks ----------
  const ask = useCallback(async (q: string) => {
    const id = ++qid.current;
    const history: Turn[] = logRef.current.filter((e) => e.kind === 'partner' || e.kind === 'patient').slice(-8)
      .map((e) => ({ speaker: e.kind === 'partner' ? 'partner' : 'patient', text: e.text, t: e.t }));
    p.addLog({ kind: 'partner', text: q });
    setQuestion(q);
    setOptions(coreOptions(classifyQuestion(q))); setGen({ source: 'core' });
    go({ name: 'choices' });
    resetEffort();
    const s = settingsRef.current;
    if (s.ai.provider === 'none' || !s.ai.apiKey) return;
    setThinking(true);
    const shownAt = effort.selections;
    const r = await generateOptions(q, history, { notes: s.patient.notes, language: s.patient.language }, s.ai);
    setThinking(false);
    if (id !== qid.current) return;
    if (r.source === 'ai' && effort.selections === shownAt) { setOptions(r.options); setBoardKey((k) => k + 1); setGen({ source: 'ai', latencyMs: r.latencyMs, model: r.model }); }
  }, [p.addLog]); // eslint-disable-line react-hooks/exhaustive-deps

  // developer-only timed trials (started from the Lab in dev builds)
  useEffect(() => {
    const t = p.pendingTrial;
    if (!t) return;
    setTrial({ ...t, start: performance.now() });
    if (t.method === 'unspoken') ask(t.partner);
    else { p.addLog({ kind: 'partner', text: t.partner }); setQuestion(t.partner); go({ name: 'spell' }); resetEffort(); }
  }, [p.pendingTrial?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMic = () => {
    if (listening) { listener.current?.stop(); return; }
    setMicError(undefined);
    listener.current = new PartnerListener(setInterim, (t) => { setInterim(''); ask(t); }, (on, err) => { setListening(on); if (err) setMicError(err); });
    listener.current.start(settings.listenLang);
  };
  useEffect(() => () => listener.current?.stop(), []);

  // ---------- patient ----------
  const choose = (o: ReplyOption) => {
    const isPain = /^pain-(yes|little|worse)/.test(o.intent) || (/\b(pain|hurt|hurts|sore|aching)\b/i.test(o.text) && !/^(no|not)\b/i.test(o.text));
    if (isPain) {
      const loc = BODY_RE.exec(o.text)?.[1];
      return loc ? go({ name: 'severity', location: loc.toLowerCase() }) : go({ name: 'where' });
    }
    go({ name: 'confirm', text: o.text, source: o.source === 'ai' ? 'ai' : 'core', from: 'choices' });
  };

  const askForHelp = () => { p.addLog({ kind: 'attention', text: 'Asked for help' }); go({ name: 'help' }); };
  useEffect(() => {
    if (screen.name !== 'help') return;
    beep(880, 300, 0.25);
    const id = setInterval(() => beep(880, 300, 0.25), 2000);
    return () => clearInterval(id);
  }, [screen.name]);

  const [lastSaid, setLastSaid] = useState<{ text: string; t: number; source: Source } | null>(null);
  useEffect(() => { if (!lastSaid) return; const id = setTimeout(() => setLastSaid(null), 7000); return () => clearTimeout(id); }, [lastSaid]);
  const sayIt = async (text: string, source: Source, pain?: { score: number; location: string }) => {
    const elapsedMs = performance.now() - msgStart.current;
    const selections = effort.selections;
    p.addLog({ kind: 'patient', text, meta: { source, selections, elapsedMs, latencyMs: source === 'ai' ? gen.latencyMs : undefined, model: source === 'ai' ? gen.model : undefined, painScore: pain?.score, painLocation: pain?.location } });
    setLastSaid({ text, t: Date.now(), source });
    if (trial) { p.onTrialDone({ method: trial.method, target: trial.target, said: text, ms: performance.now() - trial.start, selections }); setTrial(null); }
    setQuestion(''); setOptions(coreOptions('open')); setGen({ source: 'core' });
    go({ name: 'choices' });
    resetEffort();
    await speak(text, settings.voiceLang, settings.voiceName, settings.voiceRate);
  };

  // ---------- screens ----------
  const mode = settings.inputMode === 'eyes-gaze' ? 'gaze' as const : 'scan' as const;
  const board = (items: Tile[], onSelect: (i: number) => void, label: string, columns: 2 | 3 | 4 = 2) => (
    <ScanBoard key={boardKey} items={items} onSelect={onSelect} mode={mode} stepMs={settings.stepMs} input={settings.inputMode} sounds={settings.sounds} label={label} columns={columns} />
  );
  const SPELL: Tile = { key: 'spell', label: 'Spell a message', tone: 'action', group: 'actions' };
  const HELP: Tile = { key: 'help', label: 'Get help', sub: 'plays a sound', tone: 'help', group: 'actions' };
  const BACK: Tile = { key: 'back', label: 'Go back', tone: 'quiet', group: 'actions' };

  let steps: string[] | null = null;
  let stepAt = 0;
  let ui: JSX.Element;
  switch (screen.name) {
    case 'choices': {
      const tiles: Tile[] = [...options.map((o) => ({ key: o.id, label: o.text, tone: toneOf(o.text), ai: o.source === 'ai' } as Tile)),
        SPELL, { key: 'more', label: 'Something else', tone: 'action', group: 'actions' }, HELP];
      ui = board(tiles, (i) => {
        if (i < options.length) return choose(options[i]);
        const k = tiles[i].key;
        if (k === 'spell') go({ name: 'spell' }); else if (k === 'more') go({ name: 'more' }); else askForHelp();
      }, 'Choose an answer');
      break;
    }
    case 'more': {
      const items: [string, () => void][] = [
        ['Yes', () => go({ name: 'confirm', text: 'Yes', source: 'core', from: 'choices' })],
        ['No', () => go({ name: 'confirm', text: 'No', source: 'core', from: 'choices' })],
        ['I am in pain', () => go({ name: 'where' })],
        ['I need something', () => { setOptions(coreOptions('need')); go({ name: 'choices' }); }],
        ['I am scared', () => go({ name: 'confirm', text: 'I am scared', source: 'core', from: 'choices' })],
        ['Please ask me later', () => go({ name: 'confirm', text: 'Please ask me later', source: 'core', from: 'choices' })],
      ];
      const tiles: Tile[] = [...items.map(([l]) => ({ key: l, label: l, tone: toneOf(l) } as Tile)), SPELL, BACK, HELP];
      ui = board(tiles, (i) => i < items.length ? items[i][1]() : tiles[i].key === 'spell' ? go({ name: 'spell' }) : tiles[i].key === 'back' ? go({ name: 'choices' }) : askForHelp(), 'Other things to say', 3);
      break;
    }
    case 'where': {
      steps = ['Pain', 'Where', 'How bad', 'Check']; stepAt = 1;
      const tiles: Tile[] = [...BODY.map(([l]) => ({ key: l, label: l } as Tile)), { key: 'else', label: 'Somewhere else', sub: 'spell it', tone: 'action', group: 'actions' }, BACK];
      ui = board(tiles, (i) => i < BODY.length ? go({ name: 'severity', location: BODY[i][1] }) : tiles[i].key === 'else' ? go({ name: 'spell', initial: 'my ' }) : go({ name: 'choices' }), 'Where is the pain?', 4);
      break;
    }
    case 'severity': {
      steps = ['Pain', 'Where', 'How bad', 'Check']; stepAt = 2;
      const loc = screen.location;
      const tiles: Tile[] = [...BANDS.map(([l, sub]) => ({ key: l, label: l, sub } as Tile)), { key: 'skip', label: 'Skip the number', tone: 'action', group: 'actions' }, BACK];
      ui = board(tiles, (i) => i < BANDS.length ? go({ name: 'score', location: loc, band: BANDS[i][2] }) : tiles[i].key === 'skip' ? go({ name: 'confirm', text: `My ${loc} hurts.`, source: 'structured', from: 'pain' }) : go({ name: 'where' }), 'How bad is the pain?', 4);
      break;
    }
    case 'score': {
      steps = ['Pain', 'Where', 'How bad', 'Check']; stepAt = 2;
      const [a, b] = screen.band; const loc = screen.location;
      const nums = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      const tiles: Tile[] = [...nums.map((n) => ({ key: `n${n}`, label: String(n), sub: 'out of 10' } as Tile)), BACK];
      ui = board(tiles, (i) => i === nums.length ? go({ name: 'severity', location: loc }) : go({ name: 'confirm', text: `My ${loc} hurts. Pain ${nums[i]} out of 10.`, source: 'structured', pain: { score: nums[i], location: loc }, from: 'pain' }), 'Pain score', 3);
      break;
    }
    case 'confirm': {
      const s = screen;
      steps = s.from === 'pain' ? ['Pain', 'Where', 'How bad', 'Check'] : s.from === 'spell' ? ['Spell', 'Check'] : ['Choose', 'Check'];
      stepAt = steps.length - 1;
      ui = (
        <div className="confirm">
          <p className="confirm-q">Is this what you want to say?</p>
          <p className="confirm-text">“{s.text}”</p>
          {board([{ key: 'yes', label: 'Yes, say it', tone: 'yes' }, { key: 'no', label: 'No, go back', tone: 'no' }, { key: 'edit', label: 'Change the words', tone: 'action', group: 'actions' }],
            (i) => i === 0 ? sayIt(s.text, s.source, s.pain) : i === 1 ? go({ name: 'choices' }) : go({ name: 'spell', initial: s.text.toLowerCase().replace(/[.]/g, '') + ' ' }), 'Confirm your message')}
        </div>
      );
      break;
    }
    case 'spell':
      steps = ['Spell', 'Check']; stepAt = 0;
      ui = <SpellBoard key={boardKey} mode={mode} stepMs={settings.stepMs} input={settings.inputMode} sounds={settings.sounds} initial={screen.initial}
        onDone={(t) => go({ name: 'confirm', text: t, source: 'spelled', from: 'spell' })} onCancel={() => go({ name: 'choices' })} />;
      break;
    case 'help':
      ui = (
        <div className="help-screen" role="alert">
          <p className="help-title">Asking for help…</p>
          <p className="help-sub">A sound is playing so someone nearby comes over.</p>
          {board([{ key: 'stop', label: 'Stop the sound', tone: 'quiet' }], () => go({ name: 'choices' }), 'Help')}
        </div>
      );
      break;
  }

  const eyesMode = settings.inputMode !== 'switch';
  const lastPatient = [...p.log].reverse().find((e) => e.kind === 'patient');
  const recent = p.log.filter((e) => e.kind !== 'system').slice(-4).reverse();

  return (
    <div className="talk" hidden={!p.active}>
      <section className="patient-zone" aria-labelledby="pz-title">
        <h2 id="pz-title" className="sr-only">Patient</h2>
        <header className="pz-head">
          <div className="context">
            <span className="ctx-label">{question ? 'Your caregiver asked' : 'Ready when you are'}</span>
            <p className="ctx-text">{question ? `“${question}”` : 'Choose something to say, or wait for a question.'}</p>
            {thinking && <span className="ctx-note">Finding better answers…</span>}
          </div>
          {steps && (
            <ol className="stepper" aria-label="Progress">
              {steps.map((s, i) => <li key={s} className={i < stepAt ? 'done' : i === stepAt ? 'now' : ''} aria-current={i === stepAt ? 'step' : undefined}>{s}</li>)}
            </ol>
          )}
        </header>
        {lastSaid && screen.name === 'choices' && <p className="said-strip" role="status"><span aria-hidden="true">✓</span> Said aloud: “{lastSaid.text}”</p>}
        {trial && <p className="trial-bar">Timed trial ({trial.method === 'unspoken' ? 'Unspoken' : 'spelling only'}): say “{trial.target}”</p>}
        <div className="pz-body">{ui}</div>
        <footer className="pz-foot">{eyesMode ? 'Close your eyes for a moment when the yellow choice is the one you want.' : 'Press your button when the yellow choice is the one you want.'}</footer>

        {!settings.onboarded && (
          <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="ob-title">
            <div className="onboard-card">
              <p className="ob-kicker">Welcome to Unspoken</p>
              <h2 id="ob-title">How will the patient choose?</h2>
              <p>Unspoken highlights one choice at a time. The patient picks the highlighted one with a single action.</p>
              <div className="ob-options">
                <button className="ob-option" onClick={() => p.onChooseMethod('eyes-scan')}>
                  <span className="ob-icon" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34"><path d="M4 24s7-12 20-12 20 12 20 12-7 12-20 12S4 24 4 24z" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="24" cy="24" r="6" fill="currentColor" /></svg></span>
                  <b>With their eyes</b><span>Close the eyes for a moment to choose. Uses this computer's camera. Takes 20 seconds to set up.</span>
                </button>
                <button className="ob-option" onClick={() => p.onChooseMethod('switch')}>
                  <span className="ob-icon" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34"><rect x="6" y="28" width="36" height="12" rx="4" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M14 28c0-6 4-12 10-12s10 6 10 12" fill="currentColor" /></svg></span>
                  <b>With a button or key</b><span>Any key, a large button, or an adapted switch. No camera needed.</span>
                </button>
              </div>
              <p className="ob-note">You can change this any time in Preferences.</p>
            </div>
          </div>
        )}
      </section>

      <aside className="caregiver-zone" aria-labelledby="cz-title">
        {screen.name === 'help' && (
          <div className="cz-alert" role="alert">
            <b>The patient is asking for help.</b>
            <span>This is not a nurse call. Use the bed's call button in an emergency.</span>
            <button onClick={() => { p.addLog({ kind: 'system', text: 'Caregiver came to help' }); go({ name: 'choices' }); }}>I'm here</button>
          </div>
        )}
        <h2 id="cz-title">Caregiver</h2>
        <p className="cz-sub">Ask a question. The patient answers on the left.</p>
        <button className={`mic ${listening ? 'live' : ''}`} onClick={toggleMic} aria-pressed={listening}>
          <span className="mic-icon" aria-hidden="true" />{listening ? 'Listening… tap to stop' : 'Ask by voice'}
        </button>
        {micError && <p className="err" role="alert">{micError}</p>}
        {listening && <p className="interim" aria-live="polite">{interim || 'Speak normally. Your question appears for the patient.'}</p>}
        <form className="ask" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { ask(typed.trim()); setTyped(''); } }}>
          <label htmlFor="ask">Or type your question</label>
          <div className="ask-row"><input id="ask" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. Are you cold?" autoComplete="off" /><button type="submit">Ask</button></div>
        </form>
        <div className="quick" role="group" aria-label="Common questions">
          {QUICK.map((q) => <button key={q} onClick={() => ask(q)}>{q}</button>)}
        </div>

        <div className={`said-card ${lastSaid && Date.now() - lastSaid.t < 15000 ? 'fresh' : ''}`} aria-live="polite">
          <span className="said-label">Patient said</span>
          {lastPatient ? (
            <>
              <p className="said-text">“{lastPatient.text}”</p>
              <div className="said-meta">
                <span className={`badge b-${lastPatient.meta?.source}`}>{sourceLabel(lastPatient.meta?.source)}</span>
                <time>{new Date(lastPatient.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                <button className="link" onClick={() => speak(lastPatient.text, settings.voiceLang, settings.voiceName, settings.voiceRate)}>Say again</button>
              </div>
            </>
          ) : <p className="said-empty">Nothing yet. Confirmed messages appear here.</p>}
        </div>

        {eyesMode && settings.onboarded && <EyeStatus {...p} />}

        <div className="recent">
          <div className="recent-head"><h3>Recent</h3><button className="link" onClick={p.goHistory}>All history →</button></div>
          <ol>
            {recent.length === 0 && <li className="muted">No conversation yet.</li>}
            {recent.map((e) => <li key={e.id} className={`r-${e.kind}`}><span className="who">{e.kind === 'partner' ? 'You' : e.kind === 'patient' ? 'Patient' : 'Help'}</span>{e.text}</li>)}
          </ol>
        </div>
      </aside>
    </div>
  );
}

export const sourceLabel = (s?: Source) => s === 'ai' ? 'Picked a suggested answer' : s === 'spelled' ? 'Spelled it' : s === 'structured' ? 'Pain report' : 'Picked a quick answer';

function EyeStatus({ settings, cam, fps, videoRef, onStartCamera, onSetupEyes }: Props) {
  const eye = useEye();
  const running = cam.status === 'running';
  const text = cam.status === 'denied' ? 'Camera is blocked. Allow camera access in the browser, or switch to a button in Preferences.'
    : cam.status === 'error' ? 'Eye tracking could not start. Check the internet connection and reload.'
    : cam.status !== 'running' ? 'Starting the camera…'
    : !eye.present ? 'Can’t see the patient’s face. Move the screen so their face is centred and well lit.'
    : eye.closed ? (eye.holdProgress >= 1 ? 'Eyes closed long enough: opening them now will choose.' : 'Eyes closing…')
    : 'Eyes detected. Ready.';
  const state = !running || !eye.present ? 'warn' : eye.closed ? 'hold' : 'ok';
  return (
    <div className={`eye-status s-${state}`}>
      <div className={`eye-preview ${settings.showVideo ? '' : 'masked'}`}>
        <video ref={videoRef} aria-hidden="true" />
      </div>
      <div className="eye-info">
        <span className="eye-title">Eye control</span>
        <p role="status">{text}</p>
        <div className="eye-bar" aria-hidden="true"><i style={{ width: `${eye.closure * 100}%` }} /><b style={{ width: `${eye.holdProgress * 100}%` }} /></div>
        <div className="eye-actions">
          {!running && cam.status !== 'loading' && <button className="link" onClick={onStartCamera}>Start camera</button>}
          <button className="link" onClick={onSetupEyes}>{settings.calibratedAt ? 'Redo eye setup' : 'Set up eye control'}</button>
          {running && <span className="muted tiny">{fps} fps · stays on this device</span>}
        </div>
      </div>
    </div>
  );
}

export { chooseHint };

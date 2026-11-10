import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { EyeSignalProcessor, type Calibration } from './core/eyeSignal';
import { FaceTracker, type CameraStatus } from './core/camera';
import { load, save, uid, type Settings, type LogEntry, type TrialResult } from './core/store';
import { inputBus, eyeStore, frameBus } from './ui/bus';
import { CalibrationWizard } from './ui/Calibration';
import { Talk, type PendingTrial } from './pages/Talk';
import { History } from './pages/History';
import { Preferences } from './pages/Preferences';
import { About, StaffSetup } from './pages/About';

// Developer-only evaluation lab: compiled out of production builds.
const Lab = import.meta.env.DEV ? lazy(() => import('./dev/Lab')) : null;

type Route = 'talk' | 'history' | 'preferences' | 'about' | 'setup' | 'lab';
const NAV: [Route, string][] = [['talk', 'Talk'], ['history', 'History'], ['preferences', 'Preferences'], ['about', 'About']];
const parseRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  if (r === 'lab' && !Lab) return 'talk';
  return ['talk', 'history', 'preferences', 'about', 'setup', 'lab'].includes(r) ? r : 'talk';
};

export default function App() {
  const initial = useRef(load());
  const [settings, setSettings] = useState<Settings>(initial.current.settings);
  const [log, setLog] = useState<LogEntry[]>(initial.current.log);
  const [trials, setTrials] = useState<TrialResult[]>(initial.current.trials);
  const [route, setRoute] = useState<Route>(parseRoute());
  const [calibrating, setCalibrating] = useState(false);
  const [cam, setCam] = useState<{ status: CameraStatus; msg?: string }>({ status: 'off' });
  const [fps, setFps] = useState(0);
  const [toast, setToast] = useState('');
  const [pendingTrial, setPendingTrial] = useState<PendingTrial | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const proc = useRef(new EyeSignalProcessor(settings.calibration, { gazeEnabled: settings.inputMode === 'eyes-gaze' }));
  const tracker = useRef<FaceTracker | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const eyes = settings.inputMode !== 'switch';

  useEffect(() => { save({ settings, log, trials }); }, [settings, log, trials]);
  useEffect(() => {
    proc.current.setCalibration(settings.calibration);
    proc.current.setOptions({ gazeEnabled: settings.inputMode === 'eyes-gaze' });
  }, [settings.calibration, settings.inputMode]);

  // routing
  useEffect(() => { const f = () => setRoute(parseRoute()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const nav = (r: Route) => { location.hash = `/${r}`; setRoute(r); window.scrollTo(0, 0); };
  useEffect(() => {
    const titles: Record<Route, string> = { talk: 'Talk', history: 'History', preferences: 'Preferences', about: 'About', setup: 'Staff setup', lab: 'Lab' };
    document.title = `${titles[route]} · Unspoken`;
  }, [route]);

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 3500); };
  const addLog = useCallback((e: Omit<LogEntry, 'id' | 't'>) => setLog((l) => [...l, { ...e, id: uid(), t: Date.now() }]), []);

  // camera → eye signal processing → input events
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
  // The camera runs only while an eye method is chosen (privacy: off for button users).
  useEffect(() => {
    if (eyes && settings.onboarded && cam.status === 'off') startCamera();
    if (!eyes && tracker.current && cam.status === 'running') tracker.current.stop();
  }, [eyes, settings.onboarded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => tracker.current?.stop(), []);
  useEffect(() => { const id = setInterval(() => setFps(tracker.current?.fps || 0), 1000); return () => clearInterval(id); }, []);

  // keyboard / single switch (only on the Talk screen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (route !== 'talk' || calibrating || !settings.onboarded) return;
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag) && !(e.target as HTMLElement).closest('.patient-zone')) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) inputBus.emit('select', 'switch'); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); inputBus.emit('next', 'switch'); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); inputBus.emit('prev', 'switch'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, calibrating, settings.onboarded]);

  const chooseMethod = (m: Settings['inputMode']) => {
    setSettings((s) => ({ ...s, inputMode: m, onboarded: true }));
    if (m !== 'switch') setCalibrating(true);
  };
  const saveCalibration = (c: Calibration) => {
    setSettings((s) => ({ ...s, calibratedAt: Date.now(), calibration: { openClosure: c.openClosure, closedClosure: c.closedClosure, selectMinMs: c.selectMinMs, gazeNeutral: c.gazeNeutral, gazeSpan: c.gazeSpan, calibrated: true } }));
    setCalibrating(false);
    flash('Eye control is set up');
  };
  const setupEyes = () => { if (!eyes) setSettings((s) => ({ ...s, inputMode: 'eyes-scan' })); if (cam.status !== 'running') setTimeout(startCamera, 50); setCalibrating(true); };

  const camOk = cam.status === 'running';
  const status = !settings.onboarded ? null
    : !eyes ? { cls: 'ok', text: 'Using a button' }
    : cam.status === 'denied' ? { cls: 'bad', text: 'Camera blocked' }
    : !camOk ? { cls: 'warn', text: 'Starting camera…' }
    : !settings.calibratedAt ? { cls: 'warn', text: 'Eye control not set up' }
    : { cls: 'ok', text: 'Eye control on' };

  return (
    <div className="app">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <header className="top">
        <a className="brand" href="#/talk" onClick={(e) => { e.preventDefault(); nav('talk'); }} aria-label="Unspoken, go to Talk">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#172026" /><circle cx="16" cy="16" r="8" fill="none" stroke="#f2c14e" strokeWidth="3" /><path d="M16 8a8 8 0 0 1 0 16z" fill="#f2c14e" /></svg>
          <span>Unspoken</span>
        </a>
        <nav aria-label="Main">
          {NAV.map(([r, l]) => (
            <a key={r} href={`#/${r}`} className={route === r ? 'active' : ''} aria-current={route === r ? 'page' : undefined} onClick={(e) => { e.preventDefault(); nav(r); }}>{l}</a>
          ))}
        </nav>
        {status && (
          <button className={`status-pill ${status.cls}`} onClick={() => (eyes && (!settings.calibratedAt || !camOk) ? setupEyes() : nav('preferences'))}>
            <span className="pill-dot" aria-hidden="true" />{status.text}
          </button>
        )}
      </header>

      <main id="main" tabIndex={-1}>
        <Talk settings={settings} log={log} addLog={addLog} cam={cam} fps={fps} videoRef={videoRef} active={route === 'talk'}
          onStartCamera={startCamera} onSetupEyes={setupEyes} onChooseMethod={chooseMethod} goHistory={() => nav('history')}
          pendingTrial={pendingTrial}
          onTrialDone={(r) => { setTrials((t) => [...t, { id: uid(), t: Date.now(), kind: 'message', ...r, correct: true }]); flash(`Trial recorded: ${(r.ms / 1000).toFixed(1)} s`); if (Lab) nav('lab'); }} />
        {route === 'history' && <History log={log} onClear={() => { setLog([]); flash('History cleared'); }} />}
        {route === 'preferences' && <Preferences s={settings} onChange={setSettings} onSetupEyes={setupEyes} cameraReady={camOk} />}
        {route === 'about' && <About goSetup={() => nav('setup')} />}
        {route === 'setup' && <StaffSetup s={settings} onChange={setSettings} back={() => nav('about')} />}
        {route === 'lab' && Lab && (
          <Suspense fallback={<p className="page">Loading lab…</p>}>
            <Lab settings={settings} trials={trials} onTrial={(t) => setTrials((x) => [...x, t])}
              onStartMessageTrial={(target, partner, method) => { setPendingTrial({ target, partner, method, nonce: Date.now() }); nav('talk'); }} />
          </Suspense>
        )}
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
      {calibrating && <CalibrationWizard cameraReady={camOk} onClose={() => setCalibrating(false)} onSave={saveCalibration} />}
    </div>
  );
}

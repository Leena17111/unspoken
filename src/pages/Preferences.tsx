import { useEffect, useState } from 'react';
import type { Settings, InputMode } from '../core/store';
import { speak } from '../core/speech';
import { EyeSignalProcessor } from '../core/eyeSignal';
import { frameBus } from '../ui/bus';
import { beep } from '../core/speech';

const SPEEDS: [string, number][] = [['Slower', 2000], ['Normal', 1300], ['Faster', 900]];
const LANGS: [string, string][] = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ms-MY', 'Bahasa Melayu'], ['zh-CN', '中文 (普通话)'], ['ta-IN', 'தமிழ்']];

export function Preferences({ s, onChange, onSetupEyes, cameraReady }: { s: Settings; onChange: (s: Settings) => void; onSetupEyes: () => void; cameraReady: boolean }) {
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() || []);
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', load);
  }, []);
  const langVoices = voices.filter((v) => v.lang.replace('_', '-').startsWith(s.voiceLang.slice(0, 2)));
  const eyes = s.inputMode !== 'switch';

  return (
    <div className="page prefs">
      <header className="page-head"><div><h1>Preferences</h1><p>Set Unspoken up for this patient. Changes are saved straight away.</p></div></header>

      <section className="panel" aria-labelledby="p-method">
        <h2 id="p-method">How the patient chooses</h2>
        <div className="method-grid" role="radiogroup" aria-labelledby="p-method">
          {([
            ['eyes-scan', 'Close eyes to choose', 'Choices light up one by one. Close the eyes for a moment to pick the lit one. Needs only one reliable movement.'],
            ['eyes-gaze', 'Look left or right, then close eyes', 'Move between choices by glancing sideways. Faster for people who can move their eyes easily.'],
            ['switch', 'Press a button or key', 'Any key, a big button, or an adapted switch. The camera is not used.'],
          ] as [InputMode, string, string][]).map(([v, t, d]) => (
            <label key={v} className={`method ${s.inputMode === v ? 'on' : ''}`}>
              <input type="radio" name="method" checked={s.inputMode === v} onChange={() => set({ inputMode: v })} />
              <b>{t}</b><span>{d}</span>
            </label>
          ))}
        </div>
      </section>

      {eyes && (
        <section className="panel" aria-labelledby="p-eyes">
          <h2 id="p-eyes">Eye control</h2>
          <p className="muted">{s.calibratedAt ? `Set up on ${new Date(s.calibratedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Normal blinks are ignored; closing the eyes for about ${(s.calibration.selectMinMs / 1000).toFixed(1)} seconds chooses.` : 'Not set up yet. It takes about 20 seconds and makes sure normal blinking never picks anything.'}</p>
          <div className="row-actions">
            <button className="btn primary" onClick={onSetupEyes}>{s.calibratedAt ? 'Redo eye setup' : 'Set up eye control'}</button>
          </div>
          <Practice s={s} cameraReady={cameraReady} />
        </section>
      )}

      <section className="panel" aria-labelledby="p-speed">
        <h2 id="p-speed">How fast the choices move</h2>
        <div className="segmented" role="radiogroup" aria-labelledby="p-speed">
          {SPEEDS.map(([l, ms]) => (
            <label key={l} className={Math.abs(s.stepMs - ms) < 50 ? 'on' : ''}><input type="radio" name="speed" checked={Math.abs(s.stepMs - ms) < 50} onChange={() => set({ stepMs: ms })} />{l}</label>
          ))}
        </div>
        <label className="field">Fine-tune: each choice stays lit for {(s.stepMs / 1000).toFixed(1)} seconds
          <input type="range" min={600} max={3000} step={100} value={s.stepMs} onChange={(e) => set({ stepMs: Number(e.target.value) })} />
        </label>
        <p className="muted">Start slower. Speed up once the patient is comfortable. If many wrong choices happen, slow down.</p>
      </section>

      <section className="panel" aria-labelledby="p-voice">
        <h2 id="p-voice">Language and voice</h2>
        <label className="field">Language
          <select value={s.voiceLang} onChange={(e) => set({ voiceLang: e.target.value, listenLang: e.target.value, voiceName: '', patient: { ...s.patient, language: LANGS.find(([c]) => c === e.target.value)?.[1] || 'English' } })}>
            {LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </label>
        <label className="field">Voice
          <select value={s.voiceName} onChange={(e) => set({ voiceName: e.target.value })}>
            <option value="">Default voice</option>
            {langVoices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </label>
        <div className="segmented" role="radiogroup" aria-label="Speaking speed">
          {([['Slow', 0.8], ['Normal', 0.95], ['Quick', 1.1]] as [string, number][]).map(([l, r]) => (
            <label key={l} className={s.voiceRate === r ? 'on' : ''}><input type="radio" name="rate" checked={s.voiceRate === r} onChange={() => set({ voiceRate: r })} />{l}</label>
          ))}
        </div>
        <div className="row-actions"><button className="btn" onClick={() => speak(s.voiceLang.startsWith('ms') ? 'Saya rasa sakit di dada.' : 'My chest hurts.', s.voiceLang, s.voiceName, s.voiceRate)}>▶ Hear a sample</button></div>
      </section>

      <section className="panel" aria-labelledby="p-feedback">
        <h2 id="p-feedback">Feedback and privacy</h2>
        <label className="check"><input type="checkbox" checked={s.sounds} onChange={(e) => set({ sounds: e.target.checked })} /> Play soft sounds when the choice moves and when something is chosen</label>
        <label className="check"><input type="checkbox" checked={s.showVideo} onChange={(e) => set({ showVideo: e.target.checked })} /> Show the camera picture to the caregiver (the video never leaves this device)</label>
      </section>
    </div>
  );
}

/** Lets the patient check that their choosing action works, without saying anything. */
function Practice({ s, cameraReady }: { s: Settings; cameraReady: boolean }) {
  const [on, setOn] = useState(false);
  const [n, setN] = useState({ chosen: 0, ignored: 0, flash: false });
  useEffect(() => {
    if (!on) return;
    const p = new EyeSignalProcessor(s.calibration);
    return frameBus.on((f) => {
      for (const e of p.push(f)) {
        if (e.type === 'select') { beep(990, 110); setN((x) => ({ ...x, chosen: x.chosen + 1, flash: true })); setTimeout(() => setN((x) => ({ ...x, flash: false })), 450); }
        if (e.type === 'blink-ignored') setN((x) => ({ ...x, ignored: x.ignored + 1 }));
      }
    });
  }, [on, s.calibration]);
  return (
    <div className={`practice ${n.flash ? 'flash' : ''}`}>
      <div>
        <b>Practise</b>
        <p className="muted">Blink normally: nothing should happen. Then close the eyes for a moment and open them: the box lights up.</p>
        {on && <p aria-live="polite">Chosen: <b>{n.chosen}</b> · Normal blinks ignored: <b>{n.ignored}</b></p>}
      </div>
      <button className="btn" disabled={!cameraReady} onClick={() => { setN({ chosen: 0, ignored: 0, flash: false }); setOn(!on); }}>{on ? 'Stop' : cameraReady ? 'Start practice' : 'Camera not ready'}</button>
    </div>
  );
}

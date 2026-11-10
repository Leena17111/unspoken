import { useEffect, useRef, useState } from 'react';
import { calibrate, EyeSignalProcessor, type CalibrationResult, type FaceFrame, type Calibration } from '../core/eyeSignal';
import { frameBus } from './bus';
import { beep } from '../core/speech';

type Phase = 'intro' | 'relaxed' | 'closed' | 'left' | 'right' | 'result';
const STEPS: { phase: Exclude<Phase, 'intro' | 'result'>; ms: number; title: string; say: string }[] = [
  { phase: 'relaxed', ms: 7000, title: 'Look at the dot', say: 'Keep looking at the dot and blink normally.' },
  { phase: 'closed', ms: 3000, title: 'Close your eyes', say: 'Close your eyes now, and keep them closed until the second beep.' },
  { phase: 'left', ms: 2500, title: 'Glance left', say: 'Look at the left arrow, using only your eyes.' },
  { phase: 'right', ms: 2500, title: 'Glance right', say: 'Now look at the right arrow.' },
];

export function CalibrationWizard({ cameraReady, onSave, onClose }: { cameraReady: boolean; onSave: (c: Calibration) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [left, setLeft] = useState(0);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const rec = useRef<Record<string, FaceFrame[]>>({ relaxed: [], closed: [], left: [], right: [] });
  const phaseRef = useRef<Phase>('intro');
  phaseRef.current = phase;
  const [practice, setPractice] = useState({ select: 0, ignored: 0, flash: false });

  useEffect(() => frameBus.on((f) => {
    const p = phaseRef.current;
    if (p in rec.current) rec.current[p].push(f);
  }), []);

  const run = async () => {
    rec.current = { relaxed: [], closed: [], left: [], right: [] };
    for (const s of STEPS) {
      setPhase(s.phase);
      const u = new SpeechSynthesisUtterance(s.say); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u);
      await new Promise((r) => setTimeout(r, s.phase === 'closed' ? 2600 : 1600)); // time to hear the instruction
      rec.current[s.phase] = [];
      beep(660, 120);
      const end = performance.now() + s.ms;
      while (performance.now() < end) { setLeft(Math.ceil((end - performance.now()) / 1000)); await new Promise((r) => setTimeout(r, 100)); }
      beep(990, 160);
    }
    const r = calibrate({ relaxed: rec.current.relaxed, closed: rec.current.closed, left: rec.current.left, right: rec.current.right });
    setResult(r);
    setPhase('result');
  };

  // practice with the new calibration
  useEffect(() => {
    if (phase !== 'result' || !result) return;
    const p = new EyeSignalProcessor(result);
    return frameBus.on((f) => {
      for (const e of p.push(f)) {
        if (e.type === 'select') { beep(990, 110); setPractice((s) => ({ ...s, select: s.select + 1, flash: true })); setTimeout(() => setPractice((s) => ({ ...s, flash: false })), 400); }
        if (e.type === 'blink-ignored') setPractice((s) => ({ ...s, ignored: s.ignored + 1 }));
      }
    });
  }, [phase, result]);

  const step = STEPS.find((s) => s.phase === phase);
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="cal-title">
      <div className={`modal calib ${phase}`}>
        <h2 id="cal-title">Calibrate eye input</h2>
        {phase === 'intro' && (
          <>
            <p>Everyone's eyes are different. In about 20 seconds Unspoken learns what <strong>open eyes</strong>, a <strong>natural blink</strong> and a <strong>deliberate long blink</strong> look like for this person, so normal blinking never selects anything.</p>
            <ol className="plain"><li>Position the laptop so the face is centred and well lit (light in front, not behind).</li><li>Spoken instructions guide the patient. A caregiver can read them aloud too.</li></ol>
            {!cameraReady && <p className="err">The camera is not running yet. Allow camera access first.</p>}
            <div className="actions"><button className="primary" disabled={!cameraReady} onClick={run}>Start calibration</button><button onClick={onClose}>Cancel</button></div>
          </>
        )}
        {step && (
          <div className="cal-stage" aria-live="assertive">
            <p className="cal-title">{step.title}</p>
            <p>{step.say}</p>
            <div className="target">
              {phase === 'left' && <span className="arrow l">◀</span>}
              {(phase === 'relaxed' || phase === 'closed') && <span className="dot-target" />}
              {phase === 'right' && <span className="arrow r">▶</span>}
            </div>
            <p className="count">{left}s</p>
          </div>
        )}
        {phase === 'result' && result && (
          <>
            <div className={`cal-result ${result.quality.ok ? 'ok' : 'warn'}`}>
              <p className="cal-title">{result.quality.ok ? 'Calibration looks good' : 'Calibration needs attention'}</p>
              {result.quality.issues.map((i) => <p key={i}>{i}</p>)}
            </div>
            <dl className="cal-stats">
              <div><dt>Natural blinks seen</dt><dd>{result.naturalBlinks.length}{result.naturalBlinks.length ? ` (up to ${Math.round(Math.max(...result.naturalBlinks))} ms)` : ''}</dd></div>
              <div><dt>Deliberate blink must last</dt><dd>{result.selectMinMs} ms</dd></div>
              <div><dt>Open vs closed signal</dt><dd>{result.openClosure.toFixed(2)} → {result.closedClosure.toFixed(2)}</dd></div>
              <div><dt>Glance range</dt><dd>{result.gazeSpan.toFixed(2)}</dd></div>
            </dl>
            <div className={`practice ${practice.flash ? 'flash' : ''}`}>
              <strong>Practice:</strong> blink normally (should be ignored), then close your eyes for about {(result.selectMinMs / 1000).toFixed(1)} s and open them.
              <span>Selected: <b>{practice.select}</b> · Ignored blinks: <b>{practice.ignored}</b></span>
            </div>
            <div className="actions"><button className="primary" onClick={() => onSave(result)}>Use this calibration</button><button onClick={run}>Redo</button><button onClick={onClose}>Cancel</button></div>
          </>
        )}
      </div>
    </div>
  );
}

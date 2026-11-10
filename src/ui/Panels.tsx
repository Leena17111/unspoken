import { useState, type RefObject } from 'react';
import { useEye } from './bus';
import type { CameraStatus } from '../core/camera';
import type { LogEntry } from '../core/store';

export function EyeMonitor({ videoRef, status, statusMsg, showVideo, fps, mode }: {
  videoRef: RefObject<HTMLVideoElement>; status: CameraStatus; statusMsg?: string; showVideo: boolean; fps: number; mode: string;
}) {
  const eye = useEye();
  const label = status !== 'running' ? { off: 'Camera off', loading: 'Starting camera…', denied: 'Camera blocked', error: 'Camera error', running: '' }[status]
    : !eye.present ? 'No face found' : eye.closed ? (eye.holdProgress >= 1 ? 'Open eyes to choose' : 'Holding…') : 'Eyes open';
  return (
    <section className="monitor" aria-label="Eye tracking monitor">
      <div className={`video-wrap ${showVideo ? '' : 'hidden-video'}`}>
        <video ref={videoRef} className="video" aria-hidden="true" />
        {!showVideo && status === 'running' && <span className="privacy">Video hidden for privacy</span>}
        {status !== 'running' && <span className="privacy">{label}</span>}
      </div>
      <div className="meters">
        <div className={`eye-state ${eye.closed ? 'closed' : ''} ${!eye.present ? 'absent' : ''}`}>
          <span className="dot" aria-hidden="true" />{label}
        </div>
        <div className="meter" aria-label={`Eye closure ${Math.round(eye.closure * 100)} percent`}>
          <span>Closure</span><div className="bar"><i style={{ width: `${eye.closure * 100}%` }} /><b style={{ width: `${eye.holdProgress * 100}%` }} /></div>
        </div>
        {mode === 'eyes-gaze' && (
          <div className="meter" aria-label={`Gaze ${eye.gazeDir}`}>
            <span>Gaze</span>
            <div className="gaze"><i style={{ left: `${50 - Math.max(-1, Math.min(1, eye.gazeX)) * 45}%` }} /><em className="l">◀</em><em className="r">▶</em></div>
          </div>
        )}
        <p className="tiny">{status === 'running' ? `${fps} fps · on-device` : statusMsg || ''}</p>
      </div>
    </section>
  );
}

const QUICK = ['Are you in pain?', 'Do you need anything?', 'How are you feeling?', 'Are you comfortable?', 'Do you want me to call your family?'];

export function PartnerPanel({ listening, interim, onToggleMic, onAsk, log, micError, thinking }: {
  listening: boolean; interim: string; onToggleMic: () => void; onAsk: (q: string) => void; log: LogEntry[]; micError?: string; thinking: boolean;
}) {
  const [text, setText] = useState('');
  const recent = log.filter((e) => e.kind !== 'system').slice(-8);
  return (
    <aside className="partner" aria-label="Caregiver panel">
      <h2>Caregiver</h2>
      <button className={`mic ${listening ? 'live' : ''}`} onClick={onToggleMic} aria-pressed={listening}>
        <span className="mic-dot" aria-hidden="true" />{listening ? 'Listening… tap to stop' : 'Talk to the patient'}
      </button>
      {micError && <p className="err">{micError}</p>}
      {listening && <p className="interim" aria-live="polite">{interim || 'Speak naturally. Your question appears for the patient.'}</p>}
      <form className="ask" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onAsk(text.trim()); setText(''); } }}>
        <label htmlFor="ask">Or type what you said</label>
        <div className="row"><input id="ask" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Are you cold?" autoComplete="off" /><button type="submit">Ask</button></div>
      </form>
      <div className="quick" aria-label="Quick questions">
        {QUICK.map((q) => <button key={q} onClick={() => onAsk(q)}>{q}</button>)}
      </div>
      <h3>Conversation {thinking && <span className="thinking">suggesting replies…</span>}</h3>
      <ol className="chat">
        {recent.length === 0 && <li className="empty">No conversation yet.</li>}
        {recent.map((e) => (
          <li key={e.id} className={`kind-${e.kind}`}>
            <span className="who">{e.kind === 'partner' ? 'Caregiver' : e.kind === 'attention' ? 'Attention' : 'Patient'}</span>
            <span className="msg">{e.text}</span>
            {e.kind === 'patient' && e.meta && (
              <span className="meta">{[e.meta.source === 'ai' ? 'AI suggestion' : e.meta.source === 'spelled' ? 'spelled' : e.meta.source === 'structured' ? 'pain scale' : e.meta.source === 'core' ? 'core phrase' : '', e.meta.selections != null ? `${e.meta.selections} selections` : '', e.meta.elapsedMs != null ? `${(e.meta.elapsedMs / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ')}</span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}

import { useState } from 'react';
import type { Settings } from '../core/store';
import { PROVIDERS, generateOptions, type Provider } from '../core/options';

export function About({ goSetup }: { goSetup: () => void }) {
  return (
    <div className="page about">
      <header className="page-head"><div><h1>About Unspoken</h1><p>A voice for people who are awake but cannot speak.</p></div></header>
      <section className="panel prose">
        <h2>Who it is for</h2>
        <p>People who understand everything but can't speak or write right now: for example, on a breathing machine, after a stroke, or living with motor neurone disease. And the nurses, carers and families talking with them.</p>
        <h2>How it works</h2>
        <ol>
          <li><b>The caregiver asks</b> a question out loud or by typing.</li>
          <li><b>Answers appear</b> on the patient's side, lighting up one at a time.</li>
          <li><b>The patient chooses</b> by closing their eyes for a moment, or pressing a button.</li>
          <li><b>They check it</b> (“Is this what you want to say?”) and Unspoken says it aloud.</li>
        </ol>
        <p>If none of the answers fit, the patient can spell their own message. Nothing is ever said without their confirmation.</p>
        <h2>Please note</h2>
        <ul>
          <li>Unspoken is an early prototype. It has not been tested with patients and is not a medical device.</li>
          <li>“Get help” plays a sound. It is <b>not</b> a nurse-call system. Always keep the bed's call button within reach.</li>
          <li>Suggested answers are generated automatically and may not fit. The patient always chooses and confirms.</li>
        </ul>
        <h2>Privacy</h2>
        <p>The camera picture is processed on this device and never uploaded. The conversation history stays in this browser. If staff turn on smarter suggestions, the caregiver's question and recent conversation text are sent to the chosen AI service.</p>
        <p className="muted small">Open source: <a href="https://github.com/Leena17111/unspoken">github.com/Leena17111/unspoken</a> · <button className="link" onClick={goSetup}>Staff setup</button></p>
      </section>
    </div>
  );
}

/** Hidden page for staff: optional AI suggestions. Not linked from the main navigation. */
export function StaffSetup({ s, onChange, back }: { s: Settings; onChange: (s: Settings) => void; back: () => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  const [test, setTest] = useState<string>('');
  const preset = s.ai.provider !== 'none' ? PROVIDERS[s.ai.provider] : null;
  const run = async () => {
    setTest('Testing…');
    const r = await generateOptions('Are you cold?', [], { notes: s.patient.notes }, s.ai);
    setTest(r.source === 'ai' ? `Working (${Math.round(r.latencyMs)} ms): ${r.options.map((o) => o.text).join(' · ')}` : `Not working: ${r.note}`);
  };
  return (
    <div className="page">
      <header className="page-head"><div><h1>Staff setup</h1><p>Optional settings for the person setting Unspoken up. Patients and caregivers don't need this page.</p></div><button className="btn" onClick={back}>← Back to About</button></header>
      <section className="panel" aria-labelledby="ai-h">
        <h2 id="ai-h">Smarter suggested answers</h2>
        <p className="muted">Without this, Unspoken uses its built-in answers, which work offline. With a key, suggestions follow the conversation more closely. The key is stored only in this browser.</p>
        <label className="field">Service
          <select value={s.ai.provider} onChange={(e) => set({ ai: { ...s.ai, provider: e.target.value as Provider, model: '' } })}>
            <option value="none">Off (built-in answers only)</option>
            {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        {s.ai.provider !== 'none' && (
          <>
            <label className="field">API key<input type="password" value={s.ai.apiKey} placeholder={preset?.keyHint} onChange={(e) => set({ ai: { ...s.ai, apiKey: e.target.value.trim() } })} autoComplete="off" /></label>
            <label className="field">Model (optional)<input value={s.ai.model || ''} placeholder={preset?.model} onChange={(e) => set({ ai: { ...s.ai, model: e.target.value.trim() } })} /></label>
            {s.ai.provider === 'custom' && <label className="field">Base URL<input value={s.ai.baseUrl || ''} placeholder="https://…/v1" onChange={(e) => set({ ai: { ...s.ai, baseUrl: e.target.value.trim() } })} /></label>}
            <div className="row-actions"><button className="btn primary" onClick={run} disabled={!s.ai.apiKey}>Test connection</button></div>
            {test && <p className="notice" role="status">{test}</p>}
          </>
        )}
        <label className="field">Care context for suggestions (no names or record numbers)
          <textarea rows={2} value={s.patient.notes} placeholder="e.g. Has a breathing tube after surgery, alert, prefers short answers" onChange={(e) => set({ patient: { ...s.patient, notes: e.target.value } })} />
        </label>
      </section>
    </div>
  );
}

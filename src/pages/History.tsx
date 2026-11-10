import type { LogEntry } from '../core/store';
import { sourceLabel } from './Talk';

function download(name: string, content: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
}

const dayLabel = (t: number) => {
  const d = new Date(t); const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function History({ log, onClear }: { log: LogEntry[]; onClear: () => void }) {
  const entries = log.filter((e) => e.kind !== 'system');
  const pain = log.filter((e) => e.meta?.painScore != null);
  const groups = new Map<string, LogEntry[]>();
  for (const e of [...entries].reverse()) { const k = dayLabel(e.t); groups.set(k, [...(groups.get(k) || []), e]); }

  const exportText = () => {
    const lines = entries.map((e) => `${new Date(e.t).toLocaleString()}  ${e.kind === 'partner' ? 'Caregiver asked' : e.kind === 'patient' ? 'Patient said' : 'Patient asked for help'}: ${e.text}${e.kind === 'patient' ? `  (${sourceLabel(e.meta?.source)})` : ''}`);
    download('unspoken-conversation.txt', `Unspoken conversation history\nExported ${new Date().toLocaleString()}\nThis is a communication log, not a medical record.\n\n${lines.join('\n')}\n`, 'text/plain');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Conversation history</h1>
          <p>Everything the patient confirmed and said aloud, newest first. Kept only on this device.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={exportText} disabled={!entries.length}>Save as text</button>
          <button className="btn danger" onClick={() => { if (confirm('Delete the whole conversation history from this device?')) onClear(); }} disabled={!entries.length}>Clear history</button>
        </div>
      </header>

      <p className="notice">This is a record of what the patient chose to say. It is not a medical record and has not been clinically checked.</p>

      {pain.length > 0 && (
        <section className="panel" aria-labelledby="pain-h">
          <h2 id="pain-h">Pain the patient reported</h2>
          <ul className="pain-list">
            {[...pain].reverse().map((e) => (
              <li key={e.id}>
                <span className="pain-score" aria-label={`${e.meta!.painScore} out of 10`}>{e.meta!.painScore}<small>/10</small></span>
                <span><b>{cap(e.meta!.painLocation || 'Pain')}</b><br /><span className="muted">{dayLabel(e.t)} at {time(e.t)}</span></span>
                <span className="pain-bar" aria-hidden="true"><i style={{ width: `${e.meta!.painScore! * 10}%` }} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {entries.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No conversation yet</p>
          <p>When the patient confirms a message on the Talk screen, it appears here.</p>
        </div>
      ) : [...groups.entries()].map(([day, list]) => (
        <section key={day} className="day" aria-label={day}>
          <h2 className="day-h">{day}</h2>
          <ol className="history">
            {list.map((e) => (
              <li key={e.id} className={`h-${e.kind}`}>
                <time>{time(e.t)}</time>
                {e.kind === 'patient' ? (
                  <div className="h-msg">
                    <span className="h-who">Patient said</span>
                    <p className="h-text">“{e.text}”</p>
                    <span className={`badge b-${e.meta?.source}`}>{sourceLabel(e.meta?.source)}</span>
                  </div>
                ) : e.kind === 'partner' ? (
                  <div className="h-msg"><span className="h-who">Caregiver asked</span><p className="h-q">{e.text}</p></div>
                ) : (
                  <div className="h-msg"><span className="h-who help">Asked for help</span></div>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="legend muted">“Picked a suggested answer” means the patient chose one of the answers Unspoken suggested and confirmed it. “Spelled it” means they wrote it letter by letter.</p>
    </div>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

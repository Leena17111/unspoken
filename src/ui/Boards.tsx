import { useEffect, useRef, useState } from 'react';
import { Scanner, type AccessMode } from '../core/scanner';
import { LETTER_ROWS, predictWords, applyKey, finishSentence, SPACE, BACK, DONE, CANCEL } from '../core/spelling';
import { inputBus, useEye, effort } from './bus';
import { beep } from '../core/speech';

export interface Tile { key: string; label: string; sub?: string; tone?: 'ai' | 'core' | 'fixed' | 'danger' | 'primary' | 'quiet' }

interface BoardProps {
  items: Tile[];
  onSelect: (i: number) => void;
  mode: AccessMode;
  stepMs: number;
  layout?: 'list' | 'grid' | 'scale';
  sounds?: boolean;
  label: string;
}

/** Hold-to-select ring on the highlighted tile: fills while the eyes are closed. */
function HoldRing() {
  const eye = useEye();
  if (!eye.closed || eye.holdProgress <= 0) return null;
  return <span className="hold" aria-hidden="true" style={{ ['--p' as string]: eye.holdProgress }} />;
}

function useScanner(count: number, mode: AccessMode, stepMs: number, onPick: (i: number) => void, sounds = true, resetToken = '') {
  const sc = useRef<Scanner>(new Scanner(count, mode, performance.now(), { stepMs }));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => { sc.current.reset(count, performance.now()); sc.current.mode = mode; sc.current.opts.stepMs = stepMs; sc.current.opts.firstStepMs = stepMs * 1.4; setIndex(0); setPaused(false); }, [count, mode, stepMs, resetToken]);

  useEffect(() => {
    const id = setInterval(() => {
      if (sc.current.tick(performance.now())) { setIndex(sc.current.index); setPaused(sc.current.paused); if (sounds) beep(520, 25, 0.03); }
    }, 50);
    const off = inputBus.on((k) => {
      const r = sc.current.input(k, performance.now());
      setIndex(sc.current.index); setPaused(sc.current.paused);
      if (r !== null) { effort.selections++; if (sounds) beep(990, 110, 0.12); pickRef.current(r); }
    });
    return () => { clearInterval(id); off(); };
  }, [sounds]);
  return { index, paused, scanner: sc };
}

export function ScanBoard({ items, onSelect, mode, stepMs, layout = 'list', sounds, label }: BoardProps) {
  const { index, paused } = useScanner(items.length, mode, stepMs, onSelect, sounds);
  return (
    <div className={`board board-${layout}`} role="listbox" aria-label={label} aria-activedescendant={`tile-${items[index]?.key}`}>
      {paused && <p className="paused">Scanning paused. Long blink (or press Space) to resume.</p>}
      {items.map((it, i) => (
        <button
          key={it.key} id={`tile-${it.key}`} role="option" aria-selected={i === index}
          className={`tile ${it.tone || ''} ${i === index ? 'on' : ''}`}
          onClick={() => { effort.selections++; onSelect(i); }}
        >
          <span className="tile-label">{it.label}</span>
          {it.sub && <span className="tile-sub">{it.sub}</span>}
          {i === index && <HoldRing />}
        </button>
      ))}
    </div>
  );
}

/** Row–column scanning keyboard with word prediction. */
export function SpellBoard({ mode, stepMs, sounds, initial = '', onDone, onCancel }: {
  mode: AccessMode; stepMs: number; sounds?: boolean; initial?: string; onDone: (text: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [row, setRow] = useState<number | null>(null);
  const preds = predictWords(text);
  const rows: string[][] = [preds.length ? preds : ['…'], ...LETTER_ROWS];
  const count = row === null ? rows.length : rows[row].length + 1; // +1 = back to rows
  const textRef = useRef(text);
  textRef.current = text;

  const pick = (i: number) => {
    if (row === null) { if (rows[i][0] !== '…') setRow(i); return; }
    if (i === rows[row].length) { setRow(null); return; }
    const key = rows[row][i];
    setRow(null);
    if (key === DONE) { const t = finishSentence(textRef.current); if (t) onDone(t); return; }
    if (key === CANCEL) { onCancel(); return; }
    setText((t) => applyKey(t, key));
  };
  const { index } = useScanner(count, mode, stepMs, pick, sounds, `${row}|${text}`);

  return (
    <div className="spell">
      <div className="spell-text" aria-live="polite"><span>{text || <em>Start spelling…</em>}</span><span className="caret" /></div>
      <div className="spell-rows" role="grid" aria-label="Spelling board">
        {rows.map((r, ri) => {
          const rowOn = row === null ? ri === index : ri === row;
          return (
            <div key={ri} role="row" className={`spell-row ${ri === 0 ? 'pred' : ''} ${rowOn ? 'on' : ''} ${row === ri ? 'open' : ''}`}>
              {r.map((k, ki) => (
                <button key={ki} role="gridcell" tabIndex={-1}
                  className={`key ${k.length > 1 && k !== '…' ? 'word' : ''} ${row === ri && ki === index ? 'on' : ''} ${k === DONE ? 'done' : ''}`}
                  onClick={() => { effort.selections++; setRow(null); if (k === DONE) { const t = finishSentence(text); if (t) onDone(t); } else if (k === CANCEL) onCancel(); else if (k !== '…') setText((t) => applyKey(t, k)); }}>
                  {k === SPACE ? 'space' : k === BACK ? '⌫' : k}
                  {row === ri && ki === index && <HoldRing />}
                </button>
              ))}
              {row === ri && <button tabIndex={-1} className={`key back ${index === r.length ? 'on' : ''}`} onClick={() => setRow(null)}>↩{index === r.length && <HoldRing />}</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

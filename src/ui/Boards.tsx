import { useEffect, useRef, useState } from 'react';
import { Scanner, type AccessMode } from '../core/scanner';
import { LETTER_ROWS, predictWords, applyKey, finishSentence, SPACE, BACK, DONE, CANCEL } from '../core/spelling';
import { inputBus, useEye, effort } from './bus';
import { beep } from '../core/speech';

export type Tone = 'answer' | 'yes' | 'no' | 'action' | 'help' | 'quiet';
export interface Tile { key: string; label: string; sub?: string; tone?: Tone; group?: 'main' | 'actions'; ai?: boolean }

/** What to do to choose, in plain words, for the current input method. */
export function chooseHint(input: 'eyes-scan' | 'eyes-gaze' | 'switch') {
  return input === 'switch' ? 'Press your button to choose' : 'Close your eyes to choose';
}

/** Fills while the eyes are closed; a full bar means "open your eyes now to choose". */
function HoldFill() {
  const eye = useEye();
  if (!eye.closed || eye.holdProgress <= 0) return null;
  return <span className={`hold ${eye.holdProgress >= 1 ? 'full' : ''}`} aria-hidden="true" style={{ ['--p' as string]: eye.holdProgress }} />;
}

export function useScanner(count: number, mode: AccessMode, stepMs: number, onPick: (i: number) => void, sounds = true, resetToken = '') {
  const sc = useRef<Scanner>(new Scanner(count, mode, performance.now(), { stepMs }));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    sc.current.reset(count, performance.now()); sc.current.mode = mode;
    sc.current.opts.stepMs = stepMs; sc.current.opts.firstStepMs = stepMs * 1.5;
    setIndex(0); setPaused(false); setTick((t) => t + 1);
  }, [count, mode, stepMs, resetToken]);

  useEffect(() => {
    const id = setInterval(() => {
      if (sc.current.tick(performance.now())) {
        setIndex(sc.current.index); setPaused(sc.current.paused); setTick((t) => t + 1);
        if (sounds) beep(520, 25, 0.03);
      }
    }, 50);
    const off = inputBus.on((k) => {
      const r = sc.current.input(k, performance.now());
      setIndex(sc.current.index); setPaused(sc.current.paused); setTick((t) => t + 1);
      if (r !== null) { effort.selections++; if (sounds) beep(990, 110, 0.12); pickRef.current(r); }
    });
    return () => { clearInterval(id); off(); };
  }, [sounds]);
  return { index, paused, tick, first: tick <= 1 };
}

interface BoardProps {
  items: Tile[];
  onSelect: (i: number) => void;
  mode: AccessMode;
  stepMs: number;
  input: 'eyes-scan' | 'eyes-gaze' | 'switch';
  sounds?: boolean;
  label: string;
  columns?: 2 | 3 | 4;
}

/**
 * The patient's choice board. Main answers sit in a large grid; fixed actions (spell,
 * something else, get help) always sit in the same row at the bottom, so their position
 * becomes familiar. The highlighted choice is unmistakable: solid colour, a pointer, the
 * instruction to choose, a hold-progress fill, and a timer showing when the highlight moves on.
 */
export function ScanBoard({ items, onSelect, mode, stepMs, input, sounds, label, columns = 2 }: BoardProps) {
  const { index, paused, tick, first } = useScanner(items.length, mode, stepMs, onSelect, sounds);
  const main = items.map((t, i) => ({ t, i })).filter(({ t }) => t.group !== 'actions');
  const actions = items.map((t, i) => ({ t, i })).filter(({ t }) => t.group === 'actions');
  const scanning = mode === 'scan' && !paused;
  const render = ({ t, i }: { t: Tile; i: number }) => {
    const on = i === index;
    return (
      <button key={t.key} id={`tile-${t.key}`} role="option" aria-selected={on}
        className={`tile tone-${t.tone || 'answer'} ${on ? 'on' : ''}`}
        onClick={() => { effort.selections++; onSelect(i); }}>
        {t.ai && <span className="tile-ai" title="Suggested from the question">suggested</span>}
        <span className="tile-label">{t.label}</span>
        {t.sub && <span className="tile-sub">{t.sub}</span>}
        {on && <span className="tile-cta" aria-hidden="true">{paused ? (input === 'switch' ? 'Press to wake' : 'Close eyes to wake') : chooseHint(input)}</span>}
        {on && scanning && <span key={tick} className="tile-timer" aria-hidden="true" style={{ animationDuration: `${first ? stepMs * 1.5 : stepMs}ms` }} />}
        {on && <HoldFill />}
      </button>
    );
  };
  return (
    <div className="board" role="listbox" aria-label={label} aria-activedescendant={`tile-${items[index]?.key}`}>
      {paused && <p className="paused" role="status">Paused to rest your eyes. {input === 'switch' ? 'Press your button' : 'Close your eyes'} to start again.</p>}
      <div className={`board-main cols-${columns}`}>{main.map(render)}</div>
      {actions.length > 0 && <div className={`board-actions n-${actions.length}`}>{actions.map(render)}</div>}
    </div>
  );
}

/** Row–column scanning keyboard with word prediction. */
export function SpellBoard({ mode, stepMs, input, sounds, initial = '', onDone, onCancel }: {
  mode: AccessMode; stepMs: number; input: 'eyes-scan' | 'eyes-gaze' | 'switch'; sounds?: boolean; initial?: string; onDone: (text: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [row, setRow] = useState<number | null>(null);
  const preds = predictWords(text);
  const rows: string[][] = [preds.length ? preds : ['…'], ...LETTER_ROWS];
  const count = row === null ? rows.length : rows[row].length + 1; // +1 = back to rows
  const textRef = useRef(text);
  textRef.current = text;

  const press = (key: string) => {
    setRow(null);
    if (key === DONE) { const t = finishSentence(textRef.current); if (t) onDone(t); return; }
    if (key === CANCEL) { onCancel(); return; }
    if (key !== '…') setText((t) => applyKey(t, key));
  };
  const pick = (i: number) => {
    if (row === null) { if (rows[i][0] !== '…') setRow(i); return; }
    if (i === rows[row].length) { setRow(null); return; }
    press(rows[row][i]);
  };
  const { index } = useScanner(count, mode, stepMs, pick, sounds, `${row}|${text}`);
  const keyLabel = (k: string) => (k === SPACE ? 'space' : k === BACK ? '⌫ delete' : k === DONE ? 'Done ✓' : k === CANCEL ? 'Cancel' : k);

  return (
    <div className="spell">
      <div className="spell-text" aria-live="polite" aria-label="Message so far">
        <span>{text || <em>Your message will appear here</em>}</span><span className="caret" aria-hidden="true" />
      </div>
      <p className="spell-help">{row === null ? `${chooseHint(input)} a row` : `${chooseHint(input)} a letter · ↩ goes back to rows`}</p>
      <div className="spell-rows" role="grid" aria-label="Spelling board">
        {rows.map((r, ri) => {
          const rowOn = row === null && ri === index;
          return (
            <div key={ri} role="row" className={`spell-row ${ri === 0 ? 'pred' : ''} ${rowOn ? 'on' : ''} ${row === ri ? 'open' : ''} ${row !== null && row !== ri ? 'dim' : ''}`}>
              {ri === 0 && <span className="row-tag">words</span>}
              {r.map((k, ki) => (
                <button key={ki} role="gridcell" tabIndex={-1}
                  className={`key ${k.length > 1 && k !== '…' && ri === 0 ? 'word' : ''} ${row === ri && ki === index ? 'on' : ''} ${k === DONE ? 'done' : ''} ${k === CANCEL ? 'cancel' : ''}`}
                  onClick={() => { effort.selections++; press(k); }}>
                  {keyLabel(k)}
                  {row === ri && ki === index && <HoldFill />}
                </button>
              ))}
              {row === ri && <button tabIndex={-1} className={`key back ${index === r.length ? 'on' : ''}`} onClick={() => setRow(null)} aria-label="Back to rows">↩{index === r.length && <HoldFill />}</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

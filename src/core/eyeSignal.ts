/**
 * Eye signal processing: turns per-frame face blendshapes into deliberate input events.
 *
 * The core problem: people blink naturally ~15-20 times a minute. A communication aid
 * that treats every blink as a click is unusable. We separate *deliberate* long blinks
 * from natural blinks using a per-user calibrated threshold with hysteresis, a minimum
 * hold time, a refractory period and live "hold progress" feedback.
 */

export interface FaceFrame {
  t: number;          // ms timestamp
  present: boolean;   // a face was detected
  blinkL: number;     // eyeBlinkLeft blendshape 0..1
  blinkR: number;     // eyeBlinkRight
  lookOutL: number;   // eyeLookOutLeft  (left eye looks to the person's left)
  lookInL: number;    // eyeLookInLeft
  lookOutR: number;   // eyeLookOutRight (right eye looks to the person's right)
  lookInR: number;    // eyeLookInRight
}

export interface Calibration {
  openClosure: number;     // typical closure value with eyes open
  closedClosure: number;   // typical closure value with eyes deliberately closed
  selectMinMs: number;     // minimum closed duration that counts as a deliberate selection
  gazeNeutral: number;     // horizontal gaze value when looking at the screen centre
  gazeSpan: number;        // distance from neutral to a comfortable side glance
  calibrated: boolean;
}

export const DEFAULT_CALIBRATION: Calibration = {
  openClosure: 0.08, closedClosure: 0.65, selectMinMs: 550, gazeNeutral: 0, gazeSpan: 0.45, calibrated: false,
};

export type GazeDir = 'left' | 'right' | 'center';

export type EyeEvent =
  | { type: 'select'; durationMs: number; t: number }
  | { type: 'blink-ignored'; durationMs: number; t: number }
  | { type: 'gaze'; dir: 'left' | 'right'; t: number }
  | { type: 'face-lost'; t: number }
  | { type: 'face-found'; t: number };

export interface EyeState {
  present: boolean;
  closure: number;        // normalised 0 (open) .. 1 (closed)
  closed: boolean;
  closedForMs: number;
  holdProgress: number;   // 0..1 progress toward a deliberate selection while eyes are closed
  gazeX: number;          // normalised: negative = right, positive = left (person's perspective)
  gazeDir: GazeDir;
  dwellProgress: number;  // 0..1 progress toward a gaze event
}

export interface ProcessorOptions {
  emaAlpha: number;        // smoothing for closure (higher = more responsive)
  closeAt: number;         // hysteresis: normalised closure to enter "closed"
  openAt: number;          // hysteresis: normalised closure to return to "open"
  maxSelectMs: number;     // closures longer than this are treated as rest, not selection
  refractoryMs: number;    // ignore new selections right after one
  gazeEnabled: boolean;
  gazeThreshold: number;   // normalised gaze magnitude for a side glance
  gazeDwellMs: number;     // how long the glance must be held
  faceLostMs: number;
}

export const DEFAULT_OPTIONS: ProcessorOptions = {
  emaAlpha: 0.55, closeAt: 0.6, openAt: 0.35, maxSelectMs: 4000, refractoryMs: 700,
  gazeEnabled: true, gazeThreshold: 0.55, gazeDwellMs: 650, faceLostMs: 600,
};

export const rawClosure = (f: FaceFrame) => (f.blinkL + f.blinkR) / 2;
/** Positive when looking to the person's left. */
export const rawGaze = (f: FaceFrame) => ((f.lookOutL + f.lookInR) - (f.lookInL + f.lookOutR)) / 2;

export class EyeSignalProcessor {
  cal: Calibration;
  opts: ProcessorOptions;
  state: EyeState = { present: false, closure: 0, closed: false, closedForMs: 0, holdProgress: 0, gazeX: 0, gazeDir: 'center', dwellProgress: 0 };
  private ema = 0;
  private closedSince = 0;
  private lastSelectAt = -Infinity;
  private lastGazeEventAt = -Infinity;
  private gazeSince = 0;
  private gazeFired = false;
  private lastSeen = 0;
  private lostFired = true;
  private initialised = false;

  constructor(cal: Calibration = DEFAULT_CALIBRATION, opts: Partial<ProcessorOptions> = {}) {
    this.cal = cal;
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  setCalibration(cal: Calibration) { this.cal = cal; }
  setOptions(o: Partial<ProcessorOptions>) { this.opts = { ...this.opts, ...o }; }

  push(f: FaceFrame): EyeEvent[] {
    const ev: EyeEvent[] = [];
    const s = this.state;
    if (!f.present) {
      if (!this.lostFired && f.t - this.lastSeen > this.opts.faceLostMs) {
        this.lostFired = true;
        s.present = false; s.closed = false; s.holdProgress = 0; s.dwellProgress = 0;
        ev.push({ type: 'face-lost', t: f.t });
      }
      return ev;
    }
    if (this.lostFired) { this.lostFired = false; ev.push({ type: 'face-found', t: f.t }); }
    this.lastSeen = f.t;
    s.present = true;

    // --- closure: smooth, then normalise against this user's calibration ---
    const c = rawClosure(f);
    this.ema = this.initialised ? this.opts.emaAlpha * c + (1 - this.opts.emaAlpha) * this.ema : c;
    this.initialised = true;
    const span = Math.max(0.05, this.cal.closedClosure - this.cal.openClosure);
    const n = Math.min(1, Math.max(0, (this.ema - this.cal.openClosure) / span));
    s.closure = n;

    if (!s.closed && n >= this.opts.closeAt) {
      s.closed = true;
      this.closedSince = f.t;
    } else if (s.closed && n <= this.opts.openAt) {
      s.closed = false;
      const dur = f.t - this.closedSince;
      const refractory = f.t - this.lastSelectAt < this.opts.refractoryMs;
      if (dur >= this.cal.selectMinMs && dur <= this.opts.maxSelectMs && !refractory) {
        this.lastSelectAt = f.t;
        ev.push({ type: 'select', durationMs: dur, t: f.t });
      } else {
        ev.push({ type: 'blink-ignored', durationMs: dur, t: f.t });
      }
    }
    s.closedForMs = s.closed ? f.t - this.closedSince : 0;
    s.holdProgress = s.closed ? Math.min(1, s.closedForMs / this.cal.selectMinMs) : 0;
    if (s.closed && s.closedForMs > this.opts.maxSelectMs) s.holdProgress = 0; // resting eyes, not selecting

    // --- gaze: only meaningful with eyes open ---
    const g = (rawGaze(f) - this.cal.gazeNeutral) / Math.max(0.1, this.cal.gazeSpan);
    s.gazeX = s.closed ? 0 : g;
    const dir: GazeDir = s.closed || !this.opts.gazeEnabled ? 'center'
      : g >= this.opts.gazeThreshold ? 'left' : g <= -this.opts.gazeThreshold ? 'right' : 'center';
    if (dir !== s.gazeDir) { s.gazeDir = dir; this.gazeSince = f.t; this.gazeFired = false; }
    if (dir === 'center') {
      s.dwellProgress = 0;
    } else {
      const held = f.t - this.gazeSince;
      s.dwellProgress = this.gazeFired ? 1 : Math.min(1, held / this.opts.gazeDwellMs);
      if (!this.gazeFired && held >= this.opts.gazeDwellMs && f.t - this.lastGazeEventAt >= this.opts.refractoryMs) {
        this.gazeFired = true; // one event per glance: must return to centre to fire again
        this.lastGazeEventAt = f.t;
        ev.push({ type: 'gaze', dir, t: f.t });
      }
    }
    return ev;
  }
}

// ---------------- Calibration ----------------

const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a: number[], q: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

/** Durations (ms) of natural blinks found in a relaxed recording, using provisional thresholds. */
export function detectBlinks(frames: FaceFrame[], open: number, closed: number): number[] {
  const out: number[] = [];
  const mid = open + 0.5 * (closed - open);
  let since = -1;
  for (const f of frames) {
    if (!f.present) continue;
    const c = rawClosure(f);
    if (since < 0 && c >= mid) since = f.t;
    else if (since >= 0 && c < mid) { out.push(f.t - since); since = -1; }
  }
  return out;
}

export interface CalibrationRecording {
  relaxed: FaceFrame[];   // looking at the screen normally (includes natural blinks)
  closed: FaceFrame[];    // eyes deliberately closed
  left?: FaceFrame[];     // glancing left
  right?: FaceFrame[];    // glancing right
}

export interface CalibrationResult extends Calibration {
  naturalBlinks: number[];
  quality: { ok: boolean; issues: string[] };
}

export function calibrate(rec: CalibrationRecording): CalibrationResult {
  const issues: string[] = [];
  const relaxed = rec.relaxed.filter((f) => f.present);
  const closedF = rec.closed.filter((f) => f.present);
  if (relaxed.length < 20) issues.push('Face was not visible enough while relaxed. Check lighting and camera angle.');
  if (closedF.length < 10) issues.push('Face was not visible while eyes were closed.');
  // the open level ignores the natural blinks inside the relaxed window
  const openClosure = quantile(relaxed.map(rawClosure), 0.4);
  // use the last 70% of the closed window (people take a moment to close fully)
  const closedClosure = quantile(closedF.slice(Math.floor(closedF.length * 0.3)).map(rawClosure), 0.5);
  if (closedClosure - openClosure < 0.2) issues.push('Closed and open eyes look too similar. Try more light on your face, or remove glasses glare.');
  // Natural (spontaneous) blinks last roughly 100–400 ms. Anything longer in the relaxed
  // recording was a deliberate or resting closure and must not inflate the threshold.
  const naturalBlinks = detectBlinks(relaxed, openClosure, closedClosure).filter((d) => d >= 50 && d <= 550);
  // A deliberate selection must be clearly longer than this person's natural blinks,
  // but never so long that it becomes tiring (cap at 1 s).
  const longestNatural = naturalBlinks.length ? quantile(naturalBlinks, 0.95) : 250;
  const selectMinMs = Math.round(Math.min(1000, Math.max(450, longestNatural * 1.8)));

  const gazeNeutral = median(relaxed.map(rawGaze));
  let gazeSpan = DEFAULT_CALIBRATION.gazeSpan;
  if (rec.left?.length && rec.right?.length) {
    const l = median(rec.left.filter((f) => f.present).map(rawGaze)) - gazeNeutral;
    const r = gazeNeutral - median(rec.right.filter((f) => f.present).map(rawGaze));
    const m = Math.min(l, r);
    if (m < 0.08) issues.push('Left/right glances were hard to tell apart. Use blink scanning instead of gaze.');
    gazeSpan = Math.max(0.1, m);
  }
  return {
    openClosure, closedClosure, selectMinMs, gazeNeutral, gazeSpan, calibrated: true,
    naturalBlinks, quality: { ok: issues.length === 0, issues },
  };
}

/**
 * Selection controller. Supports the standard access methods used in AAC:
 *  - "scan":   items are highlighted one after another; one deliberate action selects
 *              the highlighted item (works with a long blink OR any single switch)
 *  - "gaze":   glancing left/right moves the highlight; a long blink selects
 * Auto-scan pauses after a few full cycles so an idle or resting patient is not
 * fatigued by a constantly moving highlight; any action resumes it.
 */
export type AccessMode = 'scan' | 'gaze';
export type ScanInput = 'select' | 'next' | 'prev';

export interface ScannerOptions {
  stepMs: number;           // time each item stays highlighted
  firstStepMs: number;      // extra time on the first item after the list changes
  pauseAfterCycles: number; // auto-pause after this many full cycles without a selection
}

export const DEFAULT_SCANNER: ScannerOptions = { stepMs: 1300, firstStepMs: 1800, pauseAfterCycles: 3 };

export class Scanner {
  index = 0;
  count: number;
  mode: AccessMode;
  paused = false;
  opts: ScannerOptions;
  private lastStep: number;
  private steps = 0;
  /** number of highlight moves since the list was shown (used for effort metrics) */
  moves = 0;

  constructor(count: number, mode: AccessMode, now: number, opts: Partial<ScannerOptions> = {}) {
    this.count = Math.max(1, count);
    this.mode = mode;
    this.opts = { ...DEFAULT_SCANNER, ...opts };
    this.lastStep = now;
  }

  reset(count: number, now: number) {
    this.count = Math.max(1, count);
    this.index = 0; this.steps = 0; this.moves = 0; this.paused = false; this.lastStep = now;
  }

  /** Advance auto-scan. Returns true if the highlight moved. */
  tick(now: number): boolean {
    if (this.mode !== 'scan' || this.paused || this.count < 2) return false;
    const wait = this.index === 0 && this.steps % this.count === 0 ? this.opts.firstStepMs : this.opts.stepMs;
    if (now - this.lastStep < wait) return false;
    this.lastStep = now;
    this.index = (this.index + 1) % this.count;
    this.steps++; this.moves++;
    if (this.steps >= this.count * this.opts.pauseAfterCycles) { this.paused = true; this.index = 0; }
    return true;
  }

  /** Apply an input. Returns the selected index, or null. */
  input(kind: ScanInput, now: number): number | null {
    if (kind === 'select') {
      if (this.paused) { this.paused = false; this.steps = 0; this.lastStep = now; return null; } // first action wakes the scanner
      return this.index;
    }
    this.paused = false;
    this.steps = 0;
    this.lastStep = now;
    this.moves++;
    this.index = kind === 'next' ? (this.index + 1) % this.count : (this.index - 1 + this.count) % this.count;
    return null;
  }
}

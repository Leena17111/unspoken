import { EyeSignalProcessor, calibrate, DEFAULT_CALIBRATION, type EyeEvent } from '../src/core/eyeSignal';
import { frames } from './synthetic';

const run = (p: EyeSignalProcessor, fs: ReturnType<typeof frames>) => fs.flatMap((f) => p.push(f));
const types = (ev: EyeEvent[]) => ev.map((e) => e.type).filter((t) => t !== 'face-found');

describe('EyeSignalProcessor', () => {
  it('ignores natural blinks (~150 ms) and selects on a deliberate long blink', () => {
    const p = new EyeSignalProcessor(DEFAULT_CALIBRATION);
    const ev = run(p, frames([{ ms: 500 }, { ms: 150, closure: 0.75 }, { ms: 800 }, { ms: 200, closure: 0.75 }, { ms: 800 }, { ms: 800, closure: 0.75 }, { ms: 400 }]));
    expect(types(ev)).toEqual(['blink-ignored', 'blink-ignored', 'select']);
  });

  it('treats very long eye closure as resting, not selecting', () => {
    const p = new EyeSignalProcessor(DEFAULT_CALIBRATION);
    const ev = run(p, frames([{ ms: 300 }, { ms: 6000, closure: 0.8 }, { ms: 300 }]));
    expect(types(ev)).toEqual(['blink-ignored']);
  });

  it('applies a refractory period between selections', () => {
    const p = new EyeSignalProcessor(DEFAULT_CALIBRATION, { refractoryMs: 2000 });
    const ev = run(p, frames([{ ms: 300 }, { ms: 700, closure: 0.8 }, { ms: 200 }, { ms: 700, closure: 0.8 }, { ms: 300 }]));
    expect(types(ev)).toEqual(['select', 'blink-ignored']);
  });

  it('is robust to sensor noise with eyes open (no false events in 60 s)', () => {
    const p = new EyeSignalProcessor(DEFAULT_CALIBRATION);
    const ev = run(p, frames([{ ms: 60000, closure: 0.2 }], 0, 7));
    expect(types(ev).filter((t) => t === 'select')).toHaveLength(0);
  });

  it('fires one gaze event per held glance, and needs a return to centre', () => {
    const p = new EyeSignalProcessor(DEFAULT_CALIBRATION);
    const ev = run(p, frames([{ ms: 300 }, { ms: 1500, gaze: 0.5 }, { ms: 400 }, { ms: 1000, gaze: -0.5 }, { ms: 300 }]));
    expect(ev.filter((e) => e.type === 'gaze').map((e) => (e as { dir: string }).dir)).toEqual(['left', 'right']);
  });

  it('ignores brief glances shorter than the dwell time', () => {
    const p = new EyeSignalProcessor(DEFAULT_CALIBRATION);
    const ev = run(p, frames([{ ms: 300 }, { ms: 300, gaze: 0.5 }, { ms: 300 }]));
    expect(ev.filter((e) => e.type === 'gaze')).toHaveLength(0);
  });

  it('reports face lost and found', () => {
    const p = new EyeSignalProcessor(DEFAULT_CALIBRATION);
    const ev = run(p, frames([{ ms: 300 }, { ms: 1000, present: false }, { ms: 300 }]));
    expect(ev.map((e) => e.type)).toEqual(['face-found', 'face-lost', 'face-found']);
  });

  it('reports hold progress while the eyes are closed', () => {
    const p = new EyeSignalProcessor(DEFAULT_CALIBRATION);
    run(p, frames([{ ms: 300 }, { ms: 300, closure: 0.8 }]));
    expect(p.state.closed).toBe(true);
    expect(p.state.holdProgress).toBeGreaterThan(0.2);
    expect(p.state.holdProgress).toBeLessThan(1);
  });
});

describe('calibrate', () => {
  it('learns this person\'s open/closed levels and sets the selection time above their natural blinks', () => {
    // a person with partly-closed resting eyes (0.25) and slow natural blinks (~330 ms)
    const relaxed = frames([{ ms: 1500, closure: 0.25 }, { ms: 330, closure: 0.7 }, { ms: 1500, closure: 0.25 }, { ms: 300, closure: 0.7 }, { ms: 1500, closure: 0.25 }]);
    const closed = frames([{ ms: 2000, closure: 0.7 }]);
    const left = frames([{ ms: 1500, closure: 0.25, gaze: 0.35 }]);
    const right = frames([{ ms: 1500, closure: 0.25, gaze: -0.3 }]);
    const c = calibrate({ relaxed, closed, left, right });
    expect(c.openClosure).toBeGreaterThan(0.2);
    expect(c.closedClosure).toBeGreaterThan(0.6);
    expect(c.naturalBlinks.length).toBe(2);
    expect(c.selectMinMs).toBeGreaterThan(500);
    expect(c.gazeSpan).toBeGreaterThan(0.2);
    expect(c.quality.ok).toBe(true);

    // with this calibration, a natural blink is ignored and a deliberate one selects
    const p = new EyeSignalProcessor(c);
    const ev = [...frames([{ ms: 400, closure: 0.25 }, { ms: 330, closure: 0.7 }, { ms: 600, closure: 0.25 }, { ms: 1100, closure: 0.7 }, { ms: 400, closure: 0.25 }])].flatMap((f) => p.push(f));
    expect(types(ev)).toEqual(['blink-ignored', 'select']);
  });

  it('flags a poor calibration', () => {
    const c = calibrate({ relaxed: frames([{ ms: 3000, closure: 0.3 }]), closed: frames([{ ms: 2000, closure: 0.35 }]) });
    expect(c.quality.ok).toBe(false);
  });
});

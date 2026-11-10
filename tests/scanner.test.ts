import { Scanner } from '../src/core/scanner';

describe('Scanner', () => {
  it('auto-scans and selects the highlighted item', () => {
    const s = new Scanner(4, 'scan', 0, { stepMs: 1000, firstStepMs: 1000 });
    for (let t = 0; t <= 2100; t += 100) s.tick(t);
    expect(s.index).toBe(2);
    expect(s.input('select', 2200)).toBe(2);
  });
  it('pauses after N cycles and the first action only wakes it', () => {
    const s = new Scanner(3, 'scan', 0, { stepMs: 100, firstStepMs: 100, pauseAfterCycles: 2 });
    for (let t = 0; t <= 2000; t += 10) s.tick(t);
    expect(s.paused).toBe(true);
    expect(s.input('select', 2100)).toBeNull();
    expect(s.paused).toBe(false);
    expect(s.input('select', 2150)).toBe(0);
  });
  it('gaze mode moves only on input', () => {
    const s = new Scanner(3, 'gaze', 0);
    for (let t = 0; t <= 9000; t += 100) s.tick(t);
    expect(s.index).toBe(0);
    s.input('next', 1); s.input('next', 2); s.input('next', 3);
    expect(s.index).toBe(0);
    s.input('prev', 4);
    expect(s.index).toBe(2);
  });
});

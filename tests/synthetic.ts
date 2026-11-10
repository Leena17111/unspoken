import type { FaceFrame } from '../src/core/eyeSignal';
/** Synthetic eye signal: 30 fps frames with given closure / gaze, plus small noise. */
export function frames(segments: { ms: number; closure?: number; gaze?: number; present?: boolean }[], start = 0, seed = 1): FaceFrame[] {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 0.04; };
  const out: FaceFrame[] = [];
  let t = start;
  for (const seg of segments) {
    const end = t + seg.ms;
    for (; t < end; t += 33) {
      const c = Math.min(1, Math.max(0, (seg.closure ?? 0.08) + rnd()));
      const g = seg.gaze ?? 0;
      out.push({ t, present: seg.present ?? true, blinkL: c, blinkR: c,
        lookOutL: Math.max(0, g), lookInR: Math.max(0, g), lookInL: Math.max(0, -g), lookOutR: Math.max(0, -g) });
    }
  }
  return out;
}

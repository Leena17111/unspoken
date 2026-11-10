/** Tiny shared stores: discrete input events and the live eye state. */
import { useSyncExternalStore } from 'react';
import type { EyeState } from '../core/eyeSignal';

export type InputKind = 'select' | 'next' | 'prev';
type Fn = (k: InputKind, source: 'eyes' | 'switch' | 'pointer') => void;
const inputs = new Set<Fn>();
export const inputBus = {
  emit(k: InputKind, source: 'eyes' | 'switch' | 'pointer') { inputs.forEach((f) => f(k, source)); },
  on(f: Fn) { inputs.add(f); return () => { inputs.delete(f); }; },
};

const EMPTY: EyeState = { present: false, closure: 0, closed: false, closedForMs: 0, holdProgress: 0, gazeX: 0, gazeDir: 'center', dwellProgress: 0 };
let eye: EyeState = EMPTY;
const eyeSubs = new Set<() => void>();
export const eyeStore = {
  set(s: EyeState) { eye = { ...s }; eyeSubs.forEach((f) => f()); },
  get: () => eye,
  sub(f: () => void) { eyeSubs.add(f); return () => { eyeSubs.delete(f); }; },
};
export const useEye = () => useSyncExternalStore(eyeStore.sub, eyeStore.get);

/** Counts every deliberate selection, for effort metrics. */
export const effort = { selections: 0, reset() { this.selections = 0; } };

import type { FaceFrame } from '../core/eyeSignal';
type FrameFn = (f: FaceFrame) => void;
const frameSubs = new Set<FrameFn>();
export const frameBus = {
  emit(f: FaceFrame) { frameSubs.forEach((fn) => fn(f)); },
  on(fn: FrameFn) { frameSubs.add(fn); return () => { frameSubs.delete(fn); }; },
};

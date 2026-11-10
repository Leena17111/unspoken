/** Settings and the communication log, persisted locally (never sent anywhere). */
import { DEFAULT_CALIBRATION, type Calibration } from './eyeSignal';
import type { AiSettings } from './options';

export type InputMode = 'eyes-scan' | 'eyes-gaze' | 'switch';

export interface Settings {
  inputMode: InputMode;
  stepMs: number;
  cameraOn: boolean;
  showVideo: boolean;
  sounds: boolean;
  voiceLang: string;
  listenLang: string;
  ai: AiSettings;
  patient: { name: string; notes: string; language: string };
  calibration: Calibration;
}

export const DEFAULT_SETTINGS: Settings = {
  inputMode: 'eyes-scan', stepMs: 1300, cameraOn: true, showVideo: true, sounds: true,
  voiceLang: 'en-US', listenLang: 'en-US',
  ai: { provider: 'none', apiKey: '' },
  patient: { name: '', notes: '', language: 'English' },
  calibration: DEFAULT_CALIBRATION,
};

export interface LogEntry {
  id: string;
  t: number;
  kind: 'partner' | 'patient' | 'attention' | 'system';
  text: string;
  meta?: {
    source?: 'ai' | 'core' | 'fixed' | 'spelled' | 'structured';
    latencyMs?: number;
    model?: string;
    selections?: number;
    elapsedMs?: number;
    painScore?: number;
    painLocation?: string;
  };
}

export interface TrialResult {
  id: string; t: number; kind: 'message' | 'false-activation';
  method?: 'unspoken' | 'spelling'; target?: string; said?: string;
  ms?: number; selections?: number; correct?: boolean;
  durationMs?: number; falseSelections?: number; naturalBlinks?: number;
}

const KEY = 'unspoken.v1';
interface Persisted { settings: Settings; log: LogEntry[]; trials: TrialResult[] }

export function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        settings: { ...DEFAULT_SETTINGS, ...p.settings, ai: { ...DEFAULT_SETTINGS.ai, ...p.settings?.ai }, patient: { ...DEFAULT_SETTINGS.patient, ...p.settings?.patient }, calibration: { ...DEFAULT_CALIBRATION, ...p.settings?.calibration } },
        log: p.log || [], trials: p.trials || [],
      };
    }
  } catch { /* corrupted storage: start fresh */ }
  return { settings: DEFAULT_SETTINGS, log: [], trials: [] };
}

export function save(p: Persisted) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked */ }
}

export const uid = () => Math.random().toString(36).slice(2, 10);

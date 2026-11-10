/** Speech in (partner's voice → text) and speech out (patient's chosen message → voice). */

type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};

export const speechInputSupported = () => typeof window !== 'undefined' && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);

export class PartnerListener {
  private rec: SR | null = null;
  private wanted = false;
  constructor(private onInterim: (t: string) => void, private onFinal: (t: string) => void, private onState: (listening: boolean, err?: string) => void) {}

  start(lang = 'en-US') {
    const w = window as unknown as Record<string, new () => SR>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { this.onState(false, 'Speech recognition is not supported in this browser. Use Chrome or Edge, or type instead.'); return; }
    this.wanted = true;
    const rec = new Ctor();
    rec.lang = lang; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (r.isFinal) { if (text) this.onFinal(text); } else interim += text + ' ';
      }
      this.onInterim(interim.trim());
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') { this.wanted = false; this.onState(false, 'Microphone permission denied'); } };
    rec.onend = () => { if (this.wanted) { try { rec.start(); } catch { /* restarting */ } } else this.onState(false); };
    this.rec = rec;
    rec.start();
    this.onState(true);
  }

  stop() { this.wanted = false; this.rec?.stop(); this.onState(false); }
}

export function speak(text: string, lang = 'en-US', voiceName?: string, rate = 0.95): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = rate;
    const v = window.speechSynthesis.getVoices().find((x) => x.name === voiceName) || window.speechSynthesis.getVoices().find((x) => x.lang === lang);
    if (v) u.voice = v;
    u.onend = () => resolve(); u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

/** Short audio cues so feedback works even with eyes closed. */
let ctx: AudioContext | null = null;
export function beep(freq = 880, ms = 120, vol = 0.15) {
  try {
    ctx = ctx || new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.value = vol; g.gain.setTargetAtTime(0, ctx.currentTime + ms / 1000, 0.02);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + ms / 1000 + 0.1);
  } catch { /* audio unavailable */ }
}

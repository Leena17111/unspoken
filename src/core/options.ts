/**
 * Reply-option generation.
 *
 * The AI's only job: given what the conversation partner just said, propose a few
 * short, first-person replies the patient is most likely to want, so they can answer with
 * one or two selections instead of spelling. Design rules (enforced in code, not trusted
 * to the model):
 *  - the patient always confirms before anything is spoken
 *  - "Spell it myself" and "None of these" are always present (not generated)
 *  - yes/no questions always offer both a yes and a no answer (neutrality guardrail)
 *  - output is schema-validated, length-limited, de-duplicated; failures fall back to
 *    a deterministic core vocabulary that works offline
 */
import { z } from 'zod';

export type QuestionType = 'pain' | 'yesno' | 'feeling' | 'need' | 'location' | 'choice' | 'greeting' | 'open';

export interface Turn { speaker: 'partner' | 'patient'; text: string; t: number }
export interface ReplyOption { id: string; text: string; intent: string; source: 'ai' | 'core' | 'fixed' }
export interface PatientContext { name?: string; language?: string; notes?: string }

export interface GenerationResult {
  options: ReplyOption[];
  qtype: QuestionType;
  source: 'ai' | 'core';
  latencyMs: number;
  model?: string;
  note?: string;
}

// ---------------- question understanding (deterministic) ----------------
const YESNO_START = /^(are|is|do|does|did|can|could|would|will|have|has|shall|should|want|need|you ok|ok\b|okay\b|feeling)/i;
export function classifyQuestion(text: string): QuestionType {
  const q = text.toLowerCase().trim();
  if (!q) return 'open';
  if (/\b(hurt|hurts|pain|painful|sore|ache|aching|sakit)\b/.test(q)) return 'pain';
  if (/\b(where|which part|which side)\b/.test(q)) return 'location';
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|assalamualaikum|selamat)/.test(q)) return 'greeting';
  if (/\bhow (are|do) you (feel|feeling|doing)|how('s| is) (it|everything)|how are you\b/.test(q)) return 'feeling';
  if (/\b(or)\b/.test(q) && /\?$/.test(q)) return 'choice';
  if (/\b(anything|get you|something for you)\b/.test(q)) return 'need';
  if (/\b(need|want|shall i|would you like)\b/.test(q) && !YESNO_START.test(q)) return 'need';
  if (YESNO_START.test(q) || /\b(right|okay|ok)\?$/.test(q)) return 'yesno';
  if (/\b(what|why|when|who|how)\b/.test(q)) return 'open';
  return 'open';
}

// ---------------- core vocabulary (offline fallback) ----------------
const CORE: Record<QuestionType, [string, string][]> = {
  pain: [['Yes, I am in pain', 'pain-yes'], ['No pain', 'pain-no'], ['A little', 'pain-little'], ['It is getting worse', 'pain-worse']],
  yesno: [['Yes', 'yes'], ['No', 'no'], ['I am not sure', 'unsure'], ['Please ask me later', 'later']],
  feeling: [['I am okay', 'feel-ok'], ['I feel uncomfortable', 'feel-uncomfortable'], ['I am scared', 'feel-scared'], ['I am tired', 'feel-tired']],
  need: [['Water / my mouth is dry', 'need-thirst'], ['Suction please', 'need-suction'], ['Change my position', 'need-position'], ['Call my family', 'need-family']],
  location: [['My chest', 'loc-chest'], ['My throat', 'loc-throat'], ['My head', 'loc-head'], ['My stomach', 'loc-stomach']],
  choice: [['The first one', 'choice-first'], ['The second one', 'choice-second'], ['Neither', 'choice-neither'], ['I am not sure', 'unsure']],
  greeting: [['Hello', 'greet'], ['I need something', 'need-generic'], ['I am in pain', 'pain-yes'], ['Please stay with me', 'stay']],
  open: [['I am in pain', 'pain-yes'], ['I need something', 'need-generic'], ['I am scared', 'feel-scared'], ['I want my family', 'need-family']],
};
export function coreOptions(qtype: QuestionType): ReplyOption[] {
  return CORE[qtype].map(([text, intent], i) => ({ id: `core-${qtype}-${i}`, text, intent, source: 'core' }));
}

export const FIXED_OPTIONS: ReplyOption[] = [
  { id: 'fixed-spell', text: 'Spell it myself', intent: 'spell', source: 'fixed' },
  { id: 'fixed-none', text: 'None of these', intent: 'none', source: 'fixed' },
];

// ---------------- validation + guardrails ----------------
export const AiOutputSchema = z.object({
  options: z.array(z.object({ text: z.string().min(1).max(120), intent: z.string().max(40).optional() })).min(1).max(8),
});

const AFFIRM = /^(yes|yeah|yep|ya|ok|okay|sure|please|i do|i am|i'm|i would|i want|i need|ya,)\b/i;
const NEGATE = /^(no|not|nope|i don'?t|i do not|i am not|i'm not|tidak|nothing|never)\b/i;
const UNSAFE = /\b(\d+\s?(mg|ml|mcg|units?)|overdose|kill|die|suicide|stop (the )?(ventilator|machine|treatment)|turn off)\b/i;

export function sanitizeOptions(raw: { text: string; intent?: string }[], qtype: QuestionType, max = 4): { options: ReplyOption[]; notes: string[] } {
  const notes: string[] = [];
  const seen = new Set<string>();
  let out: ReplyOption[] = [];
  for (const r of raw) {
    let text = r.text.replace(/^["'\-•\d.)\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.split(' ').length > 10) { notes.push(`dropped long option: "${text.slice(0, 40)}…"`); continue; }
    if (UNSAFE.test(text)) { notes.push(`dropped unsafe option: "${text}"`); continue; } // these must be spelled deliberately, never suggested
    const key = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    text = text[0].toUpperCase() + text.slice(1);
    out.push({ id: `ai-${out.length}`, text, intent: (r.intent || 'ai').slice(0, 40), source: 'ai' });
  }
  out = out.slice(0, max);
  // Neutrality guardrail: never offer only one side of a yes/no question.
  if (qtype === 'yesno' || qtype === 'pain') {
    const hasYes = out.some((o) => AFFIRM.test(o.text)) || (qtype === 'pain' && out.some((o) => /\b(pain|hurt|sore)\b/i.test(o.text) && !NEGATE.test(o.text)));
    const hasNo = out.some((o) => NEGATE.test(o.text));
    if (!hasNo) { out = [...out.slice(0, max - 1), { id: 'guard-no', text: qtype === 'pain' ? 'No pain' : 'No', intent: 'no', source: 'core' }]; notes.push('guardrail: added a "no" answer'); }
    if (!hasYes) { out = [{ id: 'guard-yes', text: 'Yes', intent: 'yes', source: 'core' }, ...out.slice(0, max - 1)]; notes.push('guardrail: added a "yes" answer'); }
  }
  return { options: out, notes };
}

// ---------------- LLM providers (browser-direct, user's own key) ----------------
export type Provider = 'none' | 'groq' | 'gemini' | 'openai' | 'anthropic' | 'custom';
export interface AiSettings { provider: Provider; apiKey: string; model?: string; baseUrl?: string; timeoutMs?: number }

export const PROVIDERS: Record<Exclude<Provider, 'none'>, { label: string; baseUrl: string; model: string; keyHint: string }> = {
  groq: { label: 'Groq (free tier, fastest)', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyHint: 'gsk_…' },
  gemini: { label: 'Google Gemini (free tier)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyHint: 'AIza…' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyHint: 'sk-…' },
  anthropic: { label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', keyHint: 'sk-ant-…' },
  custom: { label: 'Custom OpenAI-compatible', baseUrl: '', model: '', keyHint: '' },
};

export function buildPrompt(question: string, qtype: QuestionType, history: Turn[], ctx: PatientContext) {
  const system = [
    'You suggest replies for a patient who is awake but cannot speak (for example, intubated in intensive care).',
    'The patient picks one reply using eye blinks, so every reply costs effort: make them count.',
    'Rules:',
    '- Write 4 replies in the first person, as the patient would say them. Each at most 8 words.',
    '- Cover clearly DIFFERENT answers (e.g. yes / no / partly / something related), not paraphrases.',
    '- For yes/no questions include at least one yes and one no answer.',
    '- Be neutral: do not assume the patient feels fine, and do not assume they are distressed.',
    '- Never give medical instructions, doses or decisions. Never suggest refusing or stopping treatment.',
    `- Reply in the language the partner used${ctx.language ? ` (patient prefers ${ctx.language})` : ''}.`,
    'Return ONLY JSON: {"options":[{"text":"...","intent":"short-label"}]}',
  ].join('\n');
  const convo = history.slice(-8).map((t) => `${t.speaker === 'partner' ? 'Partner' : 'Patient'}: ${t.text}`).join('\n');
  const user = [
    ctx.notes ? `Care context (from staff): ${ctx.notes}` : '',
    convo ? `Conversation so far:\n${convo}` : '',
    `The partner just said: "${question}"`,
    `Detected question type: ${qtype}`,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

function extractJson(s: string): unknown {
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON in model output');
  return JSON.parse(s.slice(a, b + 1));
}

async function callModel(ai: AiSettings, system: string, user: string, signal: AbortSignal): Promise<{ text: string; model: string }> {
  if (ai.provider === 'none') throw new Error('no provider');
  const preset = PROVIDERS[ai.provider];
  const model = ai.model || preset.model;
  const base = (ai.baseUrl || preset.baseUrl).replace(/\/$/, '');
  if (ai.provider === 'anthropic') {
    const r = await fetch(`${base}/messages`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: 300, temperature: 0.3, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return { text: j.content.map((c: { text?: string }) => c.text || '').join(''), model };
  }
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({ model, temperature: 0.3, max_tokens: 300, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return { text: j.choices[0].message.content, model };
}

export async function generateOptions(question: string, history: Turn[], ctx: PatientContext, ai: AiSettings, max = 4): Promise<GenerationResult> {
  const qtype = classifyQuestion(question);
  const t0 = performance.now();
  if (ai.provider === 'none' || !ai.apiKey) {
    return { options: coreOptions(qtype), qtype, source: 'core', latencyMs: performance.now() - t0, note: 'offline core vocabulary' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ai.timeoutMs ?? 5000);
  try {
    const { system, user } = buildPrompt(question, qtype, history, ctx);
    const { text, model } = await callModel(ai, system, user, ctrl.signal);
    const parsed = AiOutputSchema.parse(extractJson(text));
    const { options, notes } = sanitizeOptions(parsed.options, qtype, max);
    if (options.length < 2) throw new Error('too few valid options');
    return { options, qtype, source: 'ai', latencyMs: performance.now() - t0, model, note: notes.join('; ') || undefined };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? 'timed out' : e.message) : String(e);
    return { options: coreOptions(qtype), qtype, source: 'core', latencyMs: performance.now() - t0, note: `AI unavailable (${msg}), used core vocabulary` };
  } finally {
    clearTimeout(timer);
  }
}

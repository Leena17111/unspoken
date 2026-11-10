/**
 * Communication-effort model + scripted evaluation.
 *
 * We estimate how long it takes a single-switch / blink user to say a target message:
 *   - Baseline A: conventional letter-board scanning (no prediction)
 *   - Baseline B: the same board with word prediction
 *   - Unspoken: conversation-aware reply options, falling back to spelling when no option fits
 * This is a deterministic simulation of an idealised user (no mistakes), so absolute times
 * are optimistic for everyone; the comparison is what matters. Human trials are recorded
 * separately in the app (Evaluate → Live trial) and must not be mixed with these numbers.
 */
import { LETTER_ROWS, SPACE, DONE, predictWords, applyKey } from './spelling';
import type { ReplyOption, Turn, PatientContext } from './options';

export interface EffortParams { stepMs: number; selectMs: number }
export const DEFAULT_EFFORT: EffortParams = { stepMs: 1300, selectMs: 900 };

export interface Effort { selections: number; scanSteps: number; ms: number }
const add = (a: Effort, b: Effort): Effort => ({ selections: a.selections + b.selections, scanSteps: a.scanSteps + b.scanSteps, ms: a.ms + b.ms });
const ZERO: Effort = { selections: 0, scanSteps: 0, ms: 0 };
/** Cost of selecting the item at index i in a linearly scanned list. */
export function pick(i: number, p: EffortParams): Effort {
  return { selections: 1, scanSteps: i + 1, ms: (i + 1) * p.stepMs + p.selectMs };
}

/** Row–column scanning cost of typing `target`, optionally with word prediction. */
export function spellingEffort(target: string, p: EffortParams, prediction: boolean): Effort {
  const goal = target.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  let text = '';
  let cost = ZERO;
  const rowOffset = prediction ? 1 : 0;
  let guard = 0;
  while (text.trimEnd() !== goal && guard++ < 500) {
    const rest = goal.slice(text.length);
    if (prediction) {
      const words = predictWords(text);
      const nextWord = /^([a-z']+)/.exec(goal.slice(text.replace(/[a-z']*$/, '').length))?.[1];
      const wi = nextWord ? words.indexOf(nextWord) : -1;
      if (wi >= 0) { // pick from prediction row (row 0)
        cost = add(add(cost, pick(0, p)), pick(wi, p));
        text = applyKey(text, nextWord!);
        if (text.length > goal.length) text = goal; // trailing space at end
        continue;
      }
    }
    const ch = rest[0] === ' ' ? SPACE : rest[0].toUpperCase();
    const r = LETTER_ROWS.findIndex((row) => row.includes(ch));
    const c = LETTER_ROWS[r].indexOf(ch);
    cost = add(add(cost, pick(r + rowOffset, p)), pick(c, p));
    text = applyKey(text, ch);
  }
  // finish: select the Done key
  const dr = LETTER_ROWS.findIndex((row) => row.includes(DONE));
  cost = add(add(cost, pick(dr + rowOffset, p)), pick(0, p));
  return cost;
}

export interface Scenario { id: string; partner: string; target: string; accept: RegExp; note?: string }

/** 30 scripted ICU-style exchanges. `accept` defines which reply options count as conveying the target. */
export const SCENARIOS: Scenario[] = [
  { id: 's01', partner: 'Are you in pain?', target: 'Yes I am in pain', accept: /\b(yes|pain|hurt)/i },
  { id: 's02', partner: 'Are you in any pain right now?', target: 'No pain', accept: /^no\b|no pain|not in pain/i },
  { id: 's03', partner: 'Where does it hurt?', target: 'My chest', accept: /chest/i },
  { id: 's04', partner: 'Is it your throat?', target: 'Yes my throat hurts', accept: /^yes|throat/i },
  { id: 's05', partner: 'Do you need anything?', target: 'I am thirsty', accept: /water|thirst|drink|mouth.*dry|dry mouth/i },
  { id: 's06', partner: 'Can I get you anything?', target: 'Suction please', accept: /suction|secretion|phlegm|mucus/i },
  { id: 's07', partner: 'How are you feeling today?', target: 'I am scared', accept: /scared|afraid|frighten|anxious|worried/i },
  { id: 's08', partner: 'How are you feeling?', target: 'I am okay', accept: /\b(ok|okay|fine|alright|good)\b/i },
  { id: 's09', partner: 'Do you want me to call your family?', target: 'Yes please call my family', accept: /^yes|call (my )?family|family/i },
  { id: 's10', partner: 'Would you like to sit up a bit?', target: 'Yes', accept: /^yes/i },
  { id: 's11', partner: 'Would you like to sit up a bit?', target: 'No', accept: /^no\b/i },
  { id: 's12', partner: 'Are you cold?', target: 'Yes I am cold', accept: /^yes|cold/i },
  { id: 's13', partner: 'Do you want the lights off?', target: 'Yes lights off please', accept: /^yes|lights? off/i },
  { id: 's14', partner: 'Is the pain getting better or worse?', target: 'Worse', accept: /worse/i },
  { id: 's15', partner: 'Is the pain getting better or worse?', target: 'Better', accept: /better/i },
  { id: 's16', partner: 'Do you know where you are?', target: 'Yes in hospital', accept: /^yes|hospital/i },
  { id: 's17', partner: 'Did you sleep last night?', target: 'No I could not sleep', accept: /^no\b|not sleep|couldn'?t sleep|could not sleep/i },
  { id: 's18', partner: 'Hello, I am your nurse for today.', target: 'Hello', accept: /hello|hi\b/i },
  { id: 's19', partner: 'What is wrong?', target: 'I cannot breathe well', accept: /breath|breathe/i },
  { id: 's20', partner: 'Is the tube bothering you?', target: 'Yes the tube hurts', accept: /^yes|tube/i },
  { id: 's21', partner: 'Do you want me to change your position?', target: 'Yes please', accept: /^yes/i },
  { id: 's22', partner: 'Do you need the toilet?', target: 'Yes', accept: /^yes|toilet|bathroom|bedpan/i },
  { id: 's23', partner: 'Your wife is here. Do you want to see her?', target: 'Yes please', accept: /^yes|see her|wife/i },
  { id: 's24', partner: 'Do you understand what the doctor said?', target: 'No please explain again', accept: /^no\b|explain|don'?t understand|not understand/i },
  { id: 's25', partner: 'Are you feeling sick?', target: 'A little', accept: /little|bit|slight/i },
  { id: 's26', partner: 'Do you want some music on?', target: 'No thank you', accept: /^no\b/i },
  { id: 's27', partner: 'Is your mouth dry?', target: 'Yes my mouth is dry', accept: /^yes|dry/i },
  { id: 's28', partner: 'Shall I read you the news or let you rest?', target: 'Let me rest', accept: /rest|sleep|second/i },
  { id: 's29', partner: 'Anything you want to tell your daughter?', target: 'Tell her I love her', accept: /love/i, note: 'personal message; expected to need spelling' },
  { id: 's30', partner: 'Are you worried about something?', target: 'I am worried about money', accept: /money|cost|bill|pay/i, note: 'specific concern; expected to need spelling' },
];

export type Generator = (partner: string, history: Turn[], ctx: PatientContext) => Promise<{ options: ReplyOption[]; latencyMs: number; source: string }>;

export interface ScenarioResult {
  id: string; partner: string; target: string; matched: boolean; matchIndex: number; options: string[]; source: string; latencyMs: number;
  plain: Effort; predicted: Effort; unspoken: Effort;
}

export interface EvalSummary {
  n: number; coverage: number; medianLatencyMs: number;
  mean: { plain: number; predicted: number; unspoken: number };
  meanSelections: { plain: number; predicted: number; unspoken: number };
  timeSavedVsPlain: number; timeSavedVsPredicted: number;
  results: ScenarioResult[];
}

const CONFIRM_LIST = 2; // confirm screen: [Say it, Back]

export async function runEvaluation(gen: Generator, p: EffortParams = DEFAULT_EFFORT, scenarios = SCENARIOS): Promise<EvalSummary> {
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    const g = await gen(s.partner, [], {});
    const texts = g.options.map((o) => o.text);
    const matchIndex = texts.findIndex((t) => s.accept.test(t));
    const confirm = pick(0, p); void CONFIRM_LIST;
    const plain = add(spellingEffort(s.target, p, false), confirm);
    const predicted = add(spellingEffort(s.target, p, true), confirm);
    // Unspoken root list = generated options + [Spell it myself, None of these]
    const unspoken = matchIndex >= 0
      ? add(pick(matchIndex, p), confirm)
      : add(add(pick(g.options.length, p), spellingEffort(s.target, p, true)), confirm); // go to "Spell it myself"
    results.push({ id: s.id, partner: s.partner, target: s.target, matched: matchIndex >= 0, matchIndex, options: texts, source: g.source, latencyMs: g.latencyMs, plain, predicted, unspoken });
  }
  const mean = (k: 'plain' | 'predicted' | 'unspoken', f: 'ms' | 'selections') => results.reduce((s, r) => s + r[k][f], 0) / results.length;
  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const m = { plain: mean('plain', 'ms'), predicted: mean('predicted', 'ms'), unspoken: mean('unspoken', 'ms') };
  return {
    n: results.length,
    coverage: results.filter((r) => r.matched).length / results.length,
    medianLatencyMs: lat[lat.length >> 1] ?? 0,
    mean: m,
    meanSelections: { plain: mean('plain', 'selections'), predicted: mean('predicted', 'selections'), unspoken: mean('unspoken', 'selections') },
    timeSavedVsPlain: 1 - m.unspoken / m.plain,
    timeSavedVsPredicted: 1 - m.unspoken / m.predicted,
    results,
  };
}

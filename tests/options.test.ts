import { classifyQuestion, sanitizeOptions, coreOptions, generateOptions } from '../src/core/options';

describe('classifyQuestion', () => {
  it.each([
    ['Are you in pain?', 'pain'], ['Where does it hurt?', 'pain'], ['Where are you?', 'location'],
    ['Do you want the lights off?', 'yesno'], ['How are you feeling today?', 'feeling'],
    ['Can I get you anything?', 'need'], ['Hello, I am your nurse', 'greeting'],
    ['Tea or coffee?', 'choice'], ['What happened?', 'open'],
  ])('%s → %s', (q, t) => expect(classifyQuestion(q)).toBe(t));
});

describe('sanitizeOptions (guardrails)', () => {
  it('adds a "no" when the model only offers agreement to a yes/no question', () => {
    const { options, notes } = sanitizeOptions([{ text: 'Yes please' }, { text: 'Yes, now' }, { text: 'Sure' }], 'yesno');
    expect(options.some((o) => /^no$/i.test(o.text))).toBe(true);
    expect(notes.join()).toMatch(/guardrail/);
  });
  it('adds a "yes" when the model only offers refusals', () => {
    const { options } = sanitizeOptions([{ text: 'No' }, { text: 'Not now' }], 'yesno');
    expect(options[0].text).toBe('Yes');
  });
  it('drops unsafe, overlong and duplicate options and limits to 4', () => {
    const { options, notes } = sanitizeOptions([
      { text: 'Give me 10 mg morphine' }, { text: 'Turn off the machine' },
      { text: 'this is a very long reply that goes on and on and on forever' },
      { text: 'Water please' }, { text: 'water please!' }, { text: 'Suction' }, { text: 'Blanket' }, { text: 'Family' }, { text: 'Music' },
    ], 'need');
    expect(options.map((o) => o.text)).toEqual(['Water please', 'Suction', 'Blanket', 'Family']);
    expect(notes.filter((n) => n.includes('unsafe'))).toHaveLength(2);
  });
});

describe('generateOptions', () => {
  it('uses the offline core vocabulary when no AI is configured', async () => {
    const r = await generateOptions('Are you in pain?', [], {}, { provider: 'none', apiKey: '' });
    expect(r.source).toBe('core');
    expect(r.options).toEqual(coreOptions('pain'));
  });
  it('falls back safely when the model returns garbage', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'sorry I cannot' } }] }))) as typeof fetch;
    const r = await generateOptions('Are you cold?', [], {}, { provider: 'groq', apiKey: 'x' });
    globalThis.fetch = orig;
    expect(r.source).toBe('core');
    expect(r.note).toMatch(/AI unavailable/);
  });
  it('validates and guards real-looking model output', async () => {
    const orig = globalThis.fetch;
    const content = '```json\n{"options":[{"text":"Yes, I am cold","intent":"cold-yes"},{"text":"A blanket please","intent":"blanket"},{"text":"My feet are cold","intent":"feet"}]}\n```';
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }))) as typeof fetch;
    const r = await generateOptions('Are you cold?', [], {}, { provider: 'groq', apiKey: 'x' });
    globalThis.fetch = orig;
    expect(r.source).toBe('ai');
    expect(r.options.map((o) => o.text)).toContain('No');
  });
});

import { predictWords, applyKey, finishSentence, BACK, SPACE } from '../src/core/spelling';
import { spellingEffort, DEFAULT_EFFORT } from '../src/core/evaluation';

describe('spelling', () => {
  it('predicts context-aware completions', () => {
    expect(predictWords('my ch')).toContain('chest');
    expect(predictWords('i ')[0]).toMatch(/am|want|need|can|feel/);
    expect(predictWords('wat')).toContain('water');
  });
  it('applies keys and predicted words', () => {
    let t = applyKey('', 'M'); t = applyKey(t, 'Y'); t = applyKey(t, SPACE); t = applyKey(t, 'C'); t = applyKey(t, 'chest');
    expect(t).toBe('my chest ');
    expect(applyKey('ab', BACK)).toBe('a');
    expect(finishSentence('i am cold ')).toBe('I am cold');
  });
  it('word prediction reduces scanning effort', () => {
    const plain = spellingEffort('please call my family', DEFAULT_EFFORT, false);
    const pred = spellingEffort('please call my family', DEFAULT_EFFORT, true);
    expect(pred.ms).toBeLessThan(plain.ms * 0.6);
  });
});

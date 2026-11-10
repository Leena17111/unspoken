import { runEvaluation } from '../src/core/evaluation';
import { generateOptions } from '../src/core/options';

describe('evaluation (offline core vocabulary)', () => {
  it('runs all scenarios and reports effort for every method', async () => {
    const s = await runEvaluation((q, h, c) => generateOptions(q, h, c, { provider: 'none', apiKey: '' }));
    expect(s.n).toBe(30);
    expect(s.mean.unspoken).toBeLessThan(s.mean.predicted);
    expect(s.mean.predicted).toBeLessThan(s.mean.plain);
    console.log(`coverage=${(s.coverage * 100).toFixed(0)}% plain=${(s.mean.plain / 1000).toFixed(1)}s predicted=${(s.mean.predicted / 1000).toFixed(1)}s unspoken=${(s.mean.unspoken / 1000).toFixed(1)}s savedVsPlain=${(s.timeSavedVsPlain * 100).toFixed(0)}%`);
  });
});

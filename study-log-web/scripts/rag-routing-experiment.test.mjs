import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRouting } from './rag-routing-experiment.mjs';

test('routing experiment rejects malformed model decisions before scoring', () => {
  const make = () => ({ answers: Object.fromEntries([
    ['route', ['search', 'summary', 'comparison', 'source', 'clarify']],
    ['dates', ['none', 'logs', 'events', 'both', 'uncertain']]
  ].map(([name, keys]) => [name, { type: 'choice', choice: keys[0], confidence: 1,
    probabilities: Object.fromEntries(keys.map((key, i) => [key, i ? 0 : 1])) }])) });
  assert.deepEqual(validateRouting(make()), { route: 'search', dates: 'none' });
  for (const mutate of [
    value => { value.answers.route.choice = 'invented'; },
    value => { value.answers.route.confidence = NaN; },
    value => { value.answers.dates.probabilities.none = .5; },
    value => { value.answers.dates.probabilities.other = 0; },
    value => { value.answers.extra = {}; }
  ]) {
    const value = make(); mutate(value); assert.throws(() => validateRouting(value));
  }
});

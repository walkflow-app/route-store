// A few of the matchers of vitest's `expect`, on top of node:assert, so the tests read the same as the ones in the app's repository.
import assert from 'node:assert/strict';

const matchers = (actual, negate) => {
  const check = (ok, message) => assert.ok(negate ? !ok : ok, `${negate ? 'not ' : ''}${message}`);
  return {
    toBe: expected => (negate ? assert.notStrictEqual(actual, expected) : assert.strictEqual(actual, expected)),
    toEqual: expected => (negate ? assert.notDeepStrictEqual(actual, expected) : assert.deepStrictEqual(actual, expected)),
    toBeNull: () => check(actual === null, `expected ${actual} to be null`),
    toBeGreaterThan: n => check(actual > n, `expected ${actual} to be greater than ${n}`),
    toBeLessThan: n => check(actual < n, `expected ${actual} to be less than ${n}`),
    toBeCloseTo: (n, digits = 2) => check(Math.abs(actual - n) < 10 ** -digits / 2, `expected ${actual} to be close to ${n}`),
    toMatch: re => check(re.test(actual), `expected ${JSON.stringify(actual)} to match ${re}`),
    toContain: item => check(actual.includes(item), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`),
    toHaveLength: n => check(actual.length === n, `expected length ${actual.length} to be ${n}`),
    toThrow: re => {
      let error;
      try { actual(); } catch (e) { error = e; }
      check(error !== undefined && (re === undefined || re.test(error.message)), `expected the call to throw${re ? ` ${re}` : ''}, it ${error ? `threw "${error.message}"` : 'did not throw'}`);
    },
  };
};

export const expect = actual => ({ ...matchers(actual, false), not: matchers(actual, true) });

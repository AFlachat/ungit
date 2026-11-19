const assert = require('assert');
const { pullPlan } = require('../components/repositoryModern/pullPlan');

const graph = (spec) => {
  const nodesById = {};
  for (const [sha1, parents] of Object.entries(spec))
    nodesById[sha1] = { isInited: true, sha1, parents: () => parents };
  return nodesById;
};

describe('repositoryModern pullPlan', () => {
  it('does nothing when HEAD is the remote tip', () => {
    const g = graph({ a: [] });
    assert.deepStrictEqual(pullPlan(g.a, g.a, g), { action: 'none', ahead: 0 });
  });

  it('does nothing without a remote tip', () => {
    const g = graph({ a: [] });
    assert.strictEqual(pullPlan(g.a, null, g).action, 'none');
  });

  it('fast-forwards when the remote tip descends from HEAD', () => {
    const g = graph({ r2: ['r1'], r1: ['h'], h: [] });
    assert.deepStrictEqual(pullPlan(g.h, g.r2, g), { action: 'fast-forward', ahead: 0 });
  });

  it('does nothing when HEAD is only ahead', () => {
    const g = graph({ h2: ['h1'], h1: ['r'], r: [] });
    assert.deepStrictEqual(pullPlan(g.h2, g.r, g), { action: 'none', ahead: 2 });
  });

  it('asks with the number of local commits when the branches diverged', () => {
    const g = graph({ h2: ['h1'], h1: ['base'], r1: ['base'], base: [] });
    assert.deepStrictEqual(pullPlan(g.h2, g.r1, g), { action: 'ask', ahead: 2 });
  });

  it('asks when a tip is not loaded', () => {
    const g = graph({ h: ['base'], base: [] });
    const placeholder = { isInited: false, sha1: 'r', parents: () => [] };
    assert.deepStrictEqual(pullPlan(g.h, placeholder, g), { action: 'ask', ahead: null });
  });

  it('asks when the loaded history cannot tell', () => {
    // no common ancestor loaded: the parents of both tips are past the loaded window
    const g = graph({ h: ['x'], r: ['y'] });
    assert.deepStrictEqual(pullPlan(g.h, g.r, g), { action: 'ask', ahead: null });
  });
});

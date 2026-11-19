const assert = require('assert');
const { aheadBehind } = require('../components/sidebar/aheadBehind');

const graph = (spec) => {
  const nodesById = {};
  for (const [sha1, parents] of Object.entries(spec))
    nodesById[sha1] = { sha1, parents: () => parents };
  return nodesById;
};

describe('sidebar aheadBehind', () => {
  it('counts a linear divergence', () => {
    const g = graph({ l2: ['l1'], l1: ['base'], r1: ['base'], base: [] });
    assert.deepStrictEqual(aheadBehind(g.l2, g.r1, g), { ahead: 2, behind: 1 });
  });

  it('counts side branch commits of a merge diamond', () => {
    const g = graph({ m: ['a', 'b'], a: ['base'], b: ['base'], base: [], r: ['base'] });
    assert.deepStrictEqual(aheadBehind(g.m, g.r, g), { ahead: 3, behind: 1 });
  });

  it('returns 0/0 for identical tips', () => {
    const g = graph({ x: ['y'], y: [] });
    assert.deepStrictEqual(aheadBehind(g.x, g.x, g), { ahead: 0, behind: 0 });
  });

  it('returns null when history is missing and nothing is shared', () => {
    const g = graph({ l: ['gone1'], r: ['gone2'] });
    assert.strictEqual(aheadBehind(g.l, g.r, g), null);
  });
});

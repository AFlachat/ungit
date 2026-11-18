const assert = require('assert');
const { computeLanes, laneColor } = require('../components/commitList/lanes');

const c = (sha1, ...parents) => ({ sha1, parents });

describe('[lanes]', () => {
  it('linear history stays on lane 0', () => {
    const r = computeLanes([c('C', 'B'), c('B', 'A'), c('A')]);
    r.forEach((row) => assert.strictEqual(row.dot, 0));
    assert.deepStrictEqual(r[0].up, []);
    assert.deepStrictEqual(r[0].down, [0]);
    assert.deepStrictEqual(r[2].down, []);
    assert.deepStrictEqual(r[1].up, [0]);
  });

  it('mockup history satisfies topology invariants', () => {
    const commits = [
      { sha1: 'WIP', parents: ['b1df1a16'] },
      c('b1df1a16', 'a7aeb742'),
      c('9c3e2f04', '4d21b8ec'),
      c('a7aeb742', 'fc0bc10d'),
      c('4d21b8ec', 'fc0bc10d'),
      c('fc0bc10d', 'e12f9a07'),
      c('e12f9a07', 'a73c34cc', '77ab01c3'),
      c('77ab01c3', '5ee12d90'),
      c('a73c34cc', '775bd2a2'),
      c('5ee12d90', '775bd2a2'),
      c('775bd2a2', 'a54462ee'),
      c('a54462ee', 'e376caa1'),
      c('e376caa1', '5d2ef890'),
      c('5d2ef890', '1f0c3aa8'),
      c('1f0c3aa8'),
    ];
    const rows = computeLanes(commits);
    assert.strictEqual(rows.length, commits.length);
    const expecting = {}; // lane -> sha, tracked independently from the outputs
    rows.forEach((row, i) => {
      const cm = commits[i];
      const expectedUp = Object.keys(expecting)
        .map(Number)
        .filter((l) => expecting[l] === cm.sha1)
        .sort((a, b) => a - b);
      assert.deepStrictEqual(row.up, expectedUp, `up of row ${i}`);
      if (cm.parents.length) {
        assert.strictEqual(row.down[0], row.dot, `down[0] of row ${i}`);
        assert.strictEqual(row.down.length, cm.parents.length);
      }
      row.up.forEach((l) => delete expecting[l]);
      row.down.forEach((l, k) => (expecting[l] = cm.parents[k]));
      assert.ok(row.width > Math.max(row.dot, ...row.up, ...row.down, ...row.pass));
    });
    const merge = rows[commits.findIndex((x) => x.sha1 === 'e12f9a07')];
    assert.strictEqual(new Set(merge.down).size, 2);
    const fork = rows[commits.findIndex((x) => x.sha1 === 'fc0bc10d')];
    assert.strictEqual(fork.up.length, 2);
  });

  it('octopus merge uses 3 distinct lanes, first is dot', () => {
    const r = computeLanes([c('M', 'A', 'B', 'C'), c('A'), c('B'), c('C')]);
    assert.strictEqual(new Set(r[0].down).size, 3);
    assert.strictEqual(r[0].down[0], r[0].dot);
  });

  it('parent missing from list does not crash', () => {
    const r = computeLanes([c('B', 'A', 'X')]);
    assert.deepStrictEqual(r[0].down, [0, 1]);
  });

  it('two tips sharing a parent converge', () => {
    const r = computeLanes([c('T1', 'P'), c('T2', 'P'), c('P')]);
    assert.strictEqual(r[1].dot, 1);
    assert.deepStrictEqual(r[1].down, [1]);
    assert.deepStrictEqual(r[2].up, [0, 1]);
  });

  it('reuses lanes after merges', () => {
    const commits = [];
    // each iteration: a merge (2 parents) followed by the side branch commit, then the base
    for (let i = 0; i < 200; i++) {
      commits.push(c(`m${i}`, `m${i + 1}`, `s${i}`));
      commits.push(c(`s${i}`, `m${i + 1}`));
    }
    commits.push(c('m200'));
    const r = computeLanes(commits);
    assert.ok(Math.max(...r.map((x) => x.width)) <= 3);
  });

  it('laneColor cycles', () => {
    assert.strictEqual(laneColor(5), laneColor(0));
    assert.strictEqual(laneColor(0), '#4c9aff');
  });
});

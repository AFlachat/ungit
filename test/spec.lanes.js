const assert = require('assert');
const { computeLanes, laneColor, TOP, MID, BOTTOM } = require('../components/commitList/lanes');

const c = (sha1, ...parents) => ({ sha1, parents });
const dots = (rows) => rows.map((r) => r.dot);
const straight = (seg) => seg.c1 === seg.c2;

describe('[lanes] straight branches', () => {
  it('linear history stays in column 0 with straight edges', () => {
    const r = computeLanes([c('C', 'B'), c('B', 'A'), c('A')]);
    assert.deepStrictEqual(dots(r), [0, 0, 0]);
    r.forEach((row) => row.segs.forEach((s) => assert(straight(s))));
    assert.deepStrictEqual(r[0].segs, [
      { c1: 0, y1: MID, c2: 0, y2: BOTTOM, color: laneColor(0), dashed: false },
    ]);
    assert.strictEqual(r[2].segs.length, 1); // only the edge arriving from B
  });

  it('a fork keeps the first branch child column and bends the other one in', () => {
    // A and B both branch off P
    const r = computeLanes([c('A', 'P'), c('B', 'P'), c('P')]);
    assert.deepStrictEqual(dots(r), [0, 1, 0]);
    const bend = r[2].segs.find((s) => !straight(s));
    assert.deepStrictEqual(
      [bend.c1, bend.y1, bend.c2, bend.y2],
      [1, TOP, 0, MID],
      'B bends into P on P row'
    );
  });

  it('a merged side branch stays straight in its own column', () => {
    // M merges S into main; S and A both come from B
    const r = computeLanes([c('M', 'A', 'S'), c('S', 'B'), c('A', 'B'), c('B')]);
    assert.deepStrictEqual(dots(r), [0, 1, 0, 0]);
    const out = r[0].segs.find((s) => !straight(s));
    assert.deepStrictEqual(
      [out.c1, out.y1, out.c2, out.y2],
      [0, MID, 1, BOTTOM],
      'merge edge leaves M on its row'
    );
    // row of S: S line continues down column 1, main line passes in column 0
    assert(r[2].segs.some((s) => s.c1 === 1 && s.c2 === 1 && s.y1 === TOP && s.y2 === BOTTOM));
  });

  it('long side branch keeps its column while main moves on', () => {
    const commits = [c('M', 'm3', 's3')];
    commits.push(c('s3', 's2'), c('m3', 'm2'), c('s2', 's1'), c('m2', 'm1'), c('s1', 'base'));
    commits.push(c('m1', 'base'), c('base'));
    const r = computeLanes(commits);
    const byName = Object.fromEntries(commits.map((x, i) => [x.sha1, r[i].dot]));
    ['s3', 's2', 's1'].forEach((s) => assert.strictEqual(byName[s], 1, s));
    ['M', 'm3', 'm2', 'm1', 'base'].forEach((m) => assert.strictEqual(byName[m], 0, m));
  });

  it('does not take a forbidden column', () => {
    // m merges c; d and a are branch children of c placed between m and c:
    // the merge edge of c would cross their dots, so c needs a fresh column.
    const r = computeLanes([c('m', 'a', 'c'), c('d', 'c'), c('a', 'c'), c('c')]);
    assert.deepStrictEqual(dots(r), [0, 1, 0, 2]);
  });

  it('frees and reuses columns', () => {
    const commits = [];
    for (let k = 0; k < 200; k++) {
      commits.push(c(`m${k}`, `a${k}`, `s${k}`), c(`s${k}`, `a${k}`), c(`a${k}`, `m${k + 1}`));
    }
    commits.push(c('m200'));
    const r = computeLanes(commits);
    assert(Math.max(...r.map((x) => x.width)) <= 3);
  });

  it('parents outside the list keep their edges running to the bottom', () => {
    const r = computeLanes([c('A', 'X', 'Y'), c('B', 'X')]);
    assert.deepStrictEqual(dots(r), [0, 1]);
    // row B: A's first-parent line in column 0 and the merge line towards Y both pass through
    const verticals = r[1].segs.filter((s) => straight(s) && s.y1 === TOP && s.y2 === BOTTOM);
    assert(verticals.length >= 2);
  });

  it('octopus merge gets one edge per parent', () => {
    const r = computeLanes([c('M', 'A', 'B', 'C'), c('A'), c('B'), c('C')]);
    assert.strictEqual(r[0].segs.filter((s) => s.y1 === MID).length, 3);
    assert.strictEqual(new Set(r.map((x) => x.dot)).size, 3);
  });

  it('marks the WIP edge as dashed', () => {
    const r = computeLanes([c('WIP', 'H'), c('H')]);
    assert.strictEqual(r[0].segs[0].dashed, true);
    assert.deepStrictEqual(dots(r), [0, 0]);
  });

  it('stays fast on a large history', () => {
    const commits = [];
    for (let k = 0; k < 2000; k++) {
      commits.push(c(`m${k}`, `a${k}`, `s${k}`), c(`s${k}`, `a${k}`), c(`a${k}`, `m${k + 1}`));
    }
    const t = Date.now();
    computeLanes(commits);
    assert(Date.now() - t < 1500, `took ${Date.now() - t}ms`);
  });

  it('reports the branch tip of each commit', () => {
    const r = computeLanes([c('M', 'A', 'S'), c('S', 'B'), c('A', 'B'), c('B')]);
    assert.deepStrictEqual(
      r.map((x) => x.tip),
      [0, 1, 0, 0]
    );
  });

  it('cycles the palette', () => {
    assert.strictEqual(laneColor(5), laneColor(0));
  });
});

const assert = require('assert');
const { branchOwners } = require('../components/commitList/branchOwner');

const c = (sha1, ...parents) => ({ sha1, parents });
const b = (name, sha1, extra = {}) => ({ name, sha1, isRemote: false, isCurrent: false, ...extra });

// playground-like history:
//   icons -> ui2 -> ui1 -> M (merge of auth into main) -> p -> base
//   main  -> w2  -> w1  -> M
//   auth  -> a1  -> base          (merged by M)
const commits = [
  c('icons', 'ui2'),
  c('main', 'w2'),
  c('w2', 'w1'),
  c('ui2', 'ui1'),
  c('ui1', 'M'),
  c('w1', 'M'),
  c('M', 'p', 'auth'),
  c('auth', 'a1'),
  c('a1', 'base'),
  c('p', 'base'),
  c('base'),
];

describe('[branch owner]', () => {
  it('gives the mainline history to the default branch, not to a feature branched off it', () => {
    const owners = branchOwners(commits, [
      b('feature/ui-icons', 'icons'),
      b('feature/ui', 'ui2', { isCurrent: true }),
      b('main', 'main'),
      b('feature/auth', 'auth'),
    ]);
    assert.strictEqual(owners.get('p'), 'main');
    assert.strictEqual(owners.get('base'), 'main');
    assert.strictEqual(owners.get('M'), 'main');
    assert.strictEqual(owners.get('w1'), 'main');
    assert.strictEqual(owners.get('ui1'), 'feature/ui');
    assert.strictEqual(owners.get('a1'), 'feature/auth');
    assert.strictEqual(owners.get('icons'), 'feature/ui-icons');
  });

  it('prefers the checked out branch over other feature branches', () => {
    const owners = branchOwners(commits, [
      b('feature/ui-icons', 'icons'),
      b('feature/ui', 'ui2', { isCurrent: true }),
    ]);
    assert.strictEqual(owners.get('ui1'), 'feature/ui');
    assert.strictEqual(owners.get('ui2'), 'feature/ui');
  });

  it('uses a remote default branch when there is no local one', () => {
    const owners = branchOwners(commits, [
      b('feature/ui', 'ui2'),
      b('origin/main', 'main', { isRemote: true }),
    ]);
    assert.strictEqual(owners.get('ui1'), 'feature/ui');
    // M is reached first by feature/ui (local beats remote): only the remote's own run is left
    assert.strictEqual(owners.get('w1'), 'origin/main');
  });

  it('ignores branches whose tip is not loaded and leaves orphans unowned', () => {
    const owners = branchOwners([c('x', 'y'), c('y')], [b('gone', 'zzz')]);
    assert.strictEqual(owners.size, 0);
  });
});

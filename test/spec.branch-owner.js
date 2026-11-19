const assert = require('assert');
const { branchOwners, parseMerge } = require('../components/commitList/branchOwner');

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

  it('parses merge messages', () => {
    assert.deepStrictEqual(parseMerge("Merge branch 'feat/x' into 'main'"), {
      merged: 'feat/x',
      into: 'main',
    });
    assert.deepStrictEqual(parseMerge("Merge branch 'feature/auth'"), {
      merged: 'feature/auth',
      into: null,
    });
    assert.deepStrictEqual(parseMerge("Merge remote-tracking branch 'origin/main'"), {
      merged: 'origin/main',
      into: null,
    });
    assert.deepStrictEqual(parseMerge('Merge pull request #12 from me/fix-crash'), {
      merged: 'fix-crash',
      into: null,
    });
    assert.strictEqual(parseMerge('Fix merge of things'), null);
  });

  // lil-dev-like history: main was updated with "Merge remote-tracking branch 'origin/main'",
  // whose second parent brings GitLab merge requests (feature branches deleted since); a
  // feature branch that still exists was branched off that mainline.
  it('names deleted merged branches and the mainline from merge messages', () => {
    const t = (sha1, title, ...parents) => ({ sha1, parents, title });
    const history = [
      t('main', 'chore: tip of main', 'rt'),
      t('rt', "Merge remote-tracking branch 'origin/main'", 'local1', 'mr2'),
      t('local1', 'local work', 'base'),
      t('runner', 'docs(runner)', 'mr2'),
      t('mr2', "Merge branch 'feat/rbac' into 'main'", 'mr1', 'rbac1'),
      t('rbac1', 'rbac commit', 'mr1'),
      t('mr1', "Merge branch 'feat/velero' into 'main'", 'base', 'velero1'),
      t('velero1', 'velero commit', 'base'),
      t('base', 'base'),
    ];
    const owners = branchOwners(history, [
      b('main', 'main'),
      b('origin/main', 'main', { isRemote: true }),
      b('feat/runner', 'runner'),
    ]);
    assert.strictEqual(owners.get('local1'), 'main');
    assert.strictEqual(owners.get('mr2'), 'main', 'merge into main stays on main');
    assert.strictEqual(owners.get('mr1'), 'main');
    assert.strictEqual(owners.get('rbac1'), 'feat/rbac', 'deleted branch named from message');
    assert.strictEqual(owners.get('velero1'), 'feat/velero');
    assert.strictEqual(owners.get('runner'), 'feat/runner');
  });

  it('lets unclaimed commits inherit the name of a claimed child', () => {
    const t = (sha1, title, ...parents) => ({ sha1, parents, title });
    const owners = branchOwners(
      [t('m', 'merge without known pattern', 'a', 'x'), t('x', 'x', 'a'), t('a', 'a')],
      [b('main', 'm')]
    );
    assert.strictEqual(owners.get('x'), 'main');
  });
});

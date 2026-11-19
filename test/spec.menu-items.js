const assert = require('assert');
const {
  commitMenuItems,
  refMenuItems,
  dropMenuItems,
} = require('../components/contextMenu/menuItems');

const ids = (items) => items.filter((i) => i !== 'separator').map((i) => i.id);
const find = (items, id) => items.find((i) => i !== 'separator' && i.id === id);
const assertNoBadSeparators = (items) => {
  assert.notStrictEqual(items[0], 'separator');
  assert.notStrictEqual(items[items.length - 1], 'separator');
  items.forEach((it, i) => {
    if (it === 'separator') assert.notStrictEqual(items[i + 1], 'separator');
  });
};

describe('menuItems', () => {
  describe('commitMenuItems', () => {
    const base = { sha1: 'abc', isHead: false, currentBranch: 'master', hasParent: true };

    it('HEAD with branch', () => {
      const r = ids(commitMenuItems({ ...base, isHead: true }));
      ['uncommit', 'squash', 'reset'].forEach((i) => assert(r.includes(i), i));
      ['merge-commit', 'rebase-onto-commit', 'cherry-pick'].forEach((i) =>
        assert(!r.includes(i), i)
      );
    });

    it('non-HEAD', () => {
      const items = commitMenuItems(base);
      const r = ids(items);
      ['merge-commit', 'rebase-onto-commit', 'cherry-pick', 'reset'].forEach((i) =>
        assert(r.includes(i), i)
      );
      const reset = find(items, 'reset');
      assert.deepStrictEqual(
        reset.children.map((c) => c.id),
        ['reset-soft', 'reset-mixed', 'reset-hard']
      );
      assert.strictEqual(reset.children[2].danger, true);
      assert.strictEqual(reset.label, 'Reset <b>master</b> to this commit');
      assert.strictEqual(
        find(items, 'rebase-onto-commit').label,
        'Rebase <b>master</b> onto this commit'
      );
      assert.strictEqual(reset.children[2].label, 'Hard — discard all changes');
    });

    it('detached HEAD', () => {
      const items = commitMenuItems({ ...base, currentBranch: null });
      const r = ids(items);
      ['merge-commit', 'rebase-onto-commit', 'reset', 'uncommit', 'squash'].forEach((i) =>
        assert(!r.includes(i), i)
      );
      [
        'checkout-commit',
        'create-branch',
        'create-tag',
        'cherry-pick',
        'revert',
        'copy-sha',
      ].forEach((i) => assert(r.includes(i), i));
      assertNoBadSeparators(items);
    });

    it('root commit at HEAD', () => {
      const r = ids(commitMenuItems({ ...base, isHead: true, hasParent: false }));
      assert(!r.includes('uncommit'));
      assert(!r.includes('squash'));
    });

    it('hides squash when canSquash is false', () => {
      const r = ids(commitMenuItems({ ...base, isHead: true, hasParent: true, canSquash: false }));
      assert(!r.includes('squash'));
      assert(r.includes('uncommit'));
    });

    it('escapes branch name', () => {
      const items = commitMenuItems({ ...base, currentBranch: '<img>' });
      assert(find(items, 'merge-commit').label.includes('&lt;img&gt;'));
    });
  });

  describe('refMenuItems', () => {
    const base = {
      name: 'feat',
      isLocalBranch: true,
      isRemoteBranch: false,
      isTag: false,
      isCurrent: false,
      canBePushed: true,
      hasRemoteCounterpartBehind: true,
      currentBranch: 'master',
      currentRemote: 'origin',
    };

    it('current local branch', () => {
      const items = refMenuItems({ ...base, isCurrent: true });
      const r = ids(items);
      ['checkout-ref', 'merge-ref', 'rebase-onto-ref', 'delete-ref'].forEach((i) =>
        assert(!r.includes(i), i)
      );
      assert(r.includes('copy-name'));
      assertNoBadSeparators(items);
    });

    it('other local branch', () => {
      const items = refMenuItems(base);
      assert.strictEqual(find(items, 'merge-ref').label, 'Merge <b>feat</b> into <b>master</b>');
      assert.strictEqual(find(items, 'push-ref').label, 'Push <b>feat</b> to origin');
      assert.strictEqual(find(items, 'reset-to-remote').label, 'Reset <b>feat</b> to origin/feat');
      assert.strictEqual(find(items, 'reset-to-remote').danger, true);
      assert.strictEqual(find(items, 'delete-ref').label, 'Delete <b>feat</b>');
    });

    it('remote branch', () => {
      const items = refMenuItems({
        ...base,
        name: 'origin/feat',
        isLocalBranch: false,
        isRemoteBranch: true,
      });
      const r = ids(items);
      assert(!r.includes('push-ref'));
      assert(!r.includes('reset-to-remote'));
      assert(find(items, 'delete-ref').label.endsWith('(remote)'));
      assertNoBadSeparators(items);
    });

    it('push-ref / reset-to-remote gating', () => {
      const r = ids(
        refMenuItems({ ...base, canBePushed: false, hasRemoteCounterpartBehind: false })
      );
      assert(!r.includes('push-ref'));
      assert(!r.includes('reset-to-remote'));
      const items = refMenuItems({
        ...base,
        canBePushed: false,
        hasRemoteCounterpartBehind: false,
      });
      assertNoBadSeparators(items);
    });

    it('tag', () => {
      const items = refMenuItems({ ...base, name: 'v1', isLocalBranch: false, isTag: true });
      assert.strictEqual(find(items, 'push-ref').label, 'Push tag to origin');
      assert(!ids(items).includes('reset-to-remote'));
    });

    it('escapes names', () => {
      const items = refMenuItems({ ...base, name: '<img>' });
      items
        .filter((i) => i !== 'separator')
        .forEach((i) => assert(!i.label.includes('<img>'), i.id));
      assert(find(items, 'merge-ref').label.includes('&lt;img&gt;'));
    });

    it('detached HEAD omits merge/rebase', () => {
      const r = ids(refMenuItems({ ...base, currentBranch: null }));
      assert(!r.includes('merge-ref'));
      assert(!r.includes('rebase-onto-ref'));
      assert(r.includes('checkout-ref'));
    });
  });

  describe('dropMenuItems', () => {
    it('builds items', () => {
      const items = dropMenuItems({
        refName: 'feat',
        targetSha1: 'abcdef1234',
        isCurrentRef: false,
      });
      assert.deepStrictEqual(ids(items), [
        'move-ref',
        'rebase-ref',
        'merge-into-ref',
        'reset-ref-to-commit',
      ]);
      assert.strictEqual(find(items, 'move-ref').label, 'Move <b>feat</b> here');
      assert.strictEqual(find(items, 'rebase-ref').label, 'Rebase <b>feat</b> onto abcdef1');
      assert.strictEqual(find(items, 'merge-into-ref').label, 'Merge abcdef1 into <b>feat</b>');
      assert.strictEqual(find(items, 'reset-ref-to-commit').danger, true);
      assertNoBadSeparators(items);
    });

    it('escapes ref', () => {
      const items = dropMenuItems({
        refName: '<img>',
        targetSha1: 'abcdef1234',
        isCurrentRef: true,
      });
      assert(find(items, 'move-ref').label.includes('&lt;img&gt;'));
    });
  });
});

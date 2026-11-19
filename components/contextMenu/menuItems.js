// Pure builders for the modern UI context menus. No browser or git dependencies.
// MenuItem = { id, label, danger?, children? }; labels may contain <b> around escaped ref names.

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const bold = (s) => `<b>${escapeHtml(s)}</b>`;

const item = (id, label, extra) => Object.assign({ id, label }, extra);

// Drops falsy entries, then removes leading, trailing and consecutive separators.
const compactSeparators = (items) => {
  const out = [];
  for (const it of items) {
    if (!it) continue;
    if (it === 'separator' && (out.length === 0 || out[out.length - 1] === 'separator')) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1] === 'separator') out.pop();
  return out;
};

const commitMenuItems = ({ isHead, currentBranch, hasParent, canSquash }) => {
  const onBranch = !!currentBranch;
  const branch = onBranch ? bold(currentBranch) : 'HEAD';
  return compactSeparators([
    item('checkout-commit', 'Checkout this commit (detached)'),
    item('create-branch', 'Create branch here…'),
    item('create-tag', 'Create tag here…'),
    'separator',
    !isHead && onBranch && item('merge-commit', `Merge into ${branch}`),
    !isHead && onBranch && item('rebase-onto-commit', `Rebase ${branch} onto this commit`),
    !isHead && item('cherry-pick', `Cherry-pick onto ${branch}`),
    item('revert', 'Revert this commit'),
    isHead && onBranch && hasParent && item('uncommit', 'Uncommit (keep changes)'),
    isHead &&
      onBranch &&
      hasParent &&
      canSquash !== false &&
      item('squash', 'Squash with previous…'),
    'separator',
    onBranch &&
      item('reset', `Reset ${branch} to this commit`, {
        children: [
          item('reset-soft', 'Soft — keep all changes staged'),
          item('reset-mixed', 'Mixed — keep changes unstaged'),
          item('reset-hard', 'Hard — discard all changes', { danger: true }),
        ],
      }),
    'separator',
    item('copy-sha', 'Copy commit SHA'),
    item('copy-message', 'Copy commit message'),
  ]);
};

const refMenuItems = ({
  name,
  isLocalBranch,
  isRemoteBranch,
  isTag,
  isCurrent,
  canBePushed,
  hasRemoteCounterpartBehind,
  currentBranch,
  currentRemote,
}) => {
  const ref = bold(name);
  const remote = currentRemote || 'origin';
  const canMergeRebase = !isCurrent && !!currentBranch;
  return compactSeparators([
    !isCurrent && item('checkout-ref', `Checkout ${ref}`),
    canMergeRebase && item('merge-ref', `Merge ${ref} into ${bold(currentBranch)}`),
    canMergeRebase && item('rebase-onto-ref', `Rebase ${bold(currentBranch)} onto ${ref}`),
    'separator',
    isLocalBranch && canBePushed && item('push-ref', `Push ${ref} to ${escapeHtml(remote)}`),
    isTag && canBePushed && item('push-ref', `Push tag to ${escapeHtml(remote)}`),
    isLocalBranch &&
      hasRemoteCounterpartBehind &&
      item('reset-to-remote', `Reset ${ref} to ${escapeHtml(remote)}/${escapeHtml(name)}`, {
        danger: true,
      }),
    'separator',
    !isCurrent &&
      item('delete-ref', `Delete ${ref}${isRemoteBranch ? ' (remote)' : ''}`, { danger: true }),
    item('copy-name', 'Copy name'),
  ]);
};

const dropMenuItems = ({ refName, targetSha1 }) => {
  const ref = bold(refName);
  const short = escapeHtml(String(targetSha1).slice(0, 7));
  return compactSeparators([
    item('move-ref', `Move ${ref} here`),
    item('rebase-ref', `Rebase ${ref} onto ${short}`),
    item('merge-into-ref', `Merge ${short} into ${ref}`),
    'separator',
    item('reset-ref-to-commit', `Reset ${ref} to ${short}`, { danger: true }),
  ]);
};

module.exports = { commitMenuItems, refMenuItems, dropMenuItems, escapeHtml };

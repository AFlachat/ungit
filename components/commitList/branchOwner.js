// Which branch a commit belongs to, for the "branch name on hover" of the modern commit list.
// Plain CommonJS, no browser dependencies.
//
// Branches claim the commits of their first-parent chain; a commit keeps the first claim it
// gets. Claims are made in this order:
//   1. default branches (main, master, develop, trunk), local then remote;
//   2. merge commits, read from their message ("Merge branch 'x' into 'main'",
//      "Merge remote-tracking branch 'origin/main'", "Merge pull request #1 from user/x"):
//      the merged side is named after the merged branch (even if it was deleted since), the
//      merge commit itself after the branch merged into, when the message says so;
//   3. the checked out branch, then other local branches, then remote branches;
//   4. commits still unclaimed take the name of a claimed child.
// Ties are broken by position in the list (newest first).
const DEFAULT_BRANCHES = ['main', 'master', 'develop', 'trunk'];

const shortName = (name) => name.replace(/^[^/]+\//, ''); // origin/main -> main

const MERGE_PATTERNS = [
  /^Merge (?:remote-tracking )?branch '([^']+)'(?: of \S+)?(?: into '?([^'\s]+)'?)?/,
  /^Merge pull request #\d+ from [^/\s]+\/(\S+)/,
];

// -> { merged, into } or null
const parseMerge = (title) => {
  for (const re of MERGE_PATTERNS) {
    const m = re.exec(title || '');
    if (m) return { merged: m[1], into: m[2] || null };
  }
  return null;
};

// commits: [{ sha1, parents, title }] newest first.
// branches: [{ name, sha1, isRemote, isCurrent }] (tags excluded).
// Returns Map sha1 -> branch name.
const branchOwners = (commits, branches) => {
  const bySha = new Map(commits.map((c) => [c.sha1, c]));
  const position = new Map(commits.map((c, i) => [c.sha1, i]));
  const owner = new Map();

  const claim = (sha, name) => {
    while (sha && bySha.has(sha) && !owner.has(sha)) {
      owner.set(sha, name);
      sha = bySha.get(sha).parents[0];
    }
  };
  const byPosition = (a, b) => position.get(a.sha1) - position.get(b.sha1);
  const loaded = branches.filter((b) => position.has(b.sha1)).sort(byPosition);
  const isDefault = (b) => DEFAULT_BRANCHES.includes(b.isRemote ? shortName(b.name) : b.name);

  // 1. default branches
  loaded.filter((b) => isDefault(b) && !b.isRemote).forEach((b) => claim(b.sha1, b.name));
  loaded.filter((b) => isDefault(b) && b.isRemote).forEach((b) => claim(b.sha1, b.name));

  // 2. merge messages: first the branches merged into (the mainline), then the merged sides
  const merges = commits
    .filter((c) => c.parents.length > 1)
    .map((c) => ({ c, merge: parseMerge(c.title) }))
    .filter((m) => m.merge);
  merges.forEach(({ c, merge }) => merge.into && claim(c.sha1, merge.into));
  merges.forEach(({ c, merge }) => c.parents.slice(1).forEach((p) => claim(p, merge.merged)));

  // 3. other branches
  loaded.filter((b) => b.isCurrent).forEach((b) => claim(b.sha1, b.name));
  loaded.filter((b) => !b.isRemote).forEach((b) => claim(b.sha1, b.name));
  loaded.filter((b) => b.isRemote).forEach((b) => claim(b.sha1, b.name));

  // 4. inherit from a claimed child (children are above their parents)
  commits.forEach((c) => {
    const name = owner.get(c.sha1);
    if (name) c.parents.forEach((p) => bySha.has(p) && !owner.has(p) && owner.set(p, name));
  });
  return owner;
};

module.exports = { branchOwners, parseMerge };

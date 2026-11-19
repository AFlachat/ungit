// Which branch a commit belongs to, for the "branch name on hover" of the modern commit list.
// Plain CommonJS, no browser dependencies.
//
// Branches claim the commits of their first-parent chain, in priority order; a commit belongs
// to the first branch that reaches it. Priority: default branches (main, master, develop,
// trunk), then the checked out branch, then other local branches, then remote branches; ties
// are broken by the tip's position in the list (newest first).
const DEFAULT_BRANCHES = ['main', 'master', 'develop', 'trunk'];

const shortName = (name) => name.replace(/^[^/]+\//, ''); // origin/main -> main

const rank = (b) => {
  const base = b.isRemote ? shortName(b.name) : b.name;
  const isDefault = DEFAULT_BRANCHES.includes(base);
  if (!b.isRemote && isDefault) return 0;
  if (b.isCurrent) return 1;
  if (!b.isRemote) return 2;
  return isDefault ? 3 : 4;
};

// commits: [{ sha1, parents }] newest first.
// branches: [{ name, sha1, isRemote, isCurrent }] (tags excluded).
// Returns Map sha1 -> branch name.
const branchOwners = (commits, branches) => {
  const firstParent = new Map(commits.map((c) => [c.sha1, c.parents[0]]));
  const position = new Map(commits.map((c, i) => [c.sha1, i]));
  const ordered = branches
    .filter((b) => position.has(b.sha1))
    .sort((a, b) => rank(a) - rank(b) || position.get(a.sha1) - position.get(b.sha1));
  const owner = new Map();
  ordered.forEach((b) => {
    let sha = b.sha1;
    while (sha && position.has(sha) && !owner.has(sha)) {
      owner.set(sha, b.name);
      sha = firstParent.get(sha);
    }
  });
  return owner;
};

module.exports = { branchOwners };

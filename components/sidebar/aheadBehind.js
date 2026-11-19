// Ahead/behind counts between two commits, like `git rev-list --left-right --count a...b`,
// computed on the loaded part of the graph. Linear in the number of loaded nodes.

// Walks the ancestors of `tip` (inclusive) iteratively; `missing` tells whether a parent was not loaded.
const walk = (tip, nodesById) => {
  const seen = new Set();
  let missing = false;
  const stack = [tip.sha1];
  while (stack.length) {
    const sha1 = stack.pop();
    if (seen.has(sha1)) continue;
    const node = nodesById[sha1];
    if (!node) {
      missing = true;
      continue;
    }
    seen.add(sha1);
    for (const parent of node.parents()) stack.push(parent);
  }
  return { seen, missing };
};

// Returns { ahead, behind } or null when the numbers cannot be justified (history not loaded far enough).
exports.aheadBehind = (localNode, remoteNode, nodesById) => {
  const a = walk(localNode, nodesById);
  const b = walk(remoteNode, nodesById);
  let ahead = 0;
  let behind = 0;
  let common = false;
  for (const sha1 of a.seen) {
    if (b.seen.has(sha1)) common = true;
    else ahead++;
  }
  for (const sha1 of b.seen) if (!a.seen.has(sha1)) behind++;
  if ((a.missing || b.missing) && !common) return null;
  return { ahead, behind };
};

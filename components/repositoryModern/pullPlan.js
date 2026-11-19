// Decides what Pull (fetch, then rebase onto the remote branch) has to do, on the loaded graph.
// No browser or git dependencies.
const { aheadBehind } = require('../sidebar/aheadBehind');

// Returns { action, ahead }:
// - 'none': nothing to pull (same commit, or the local branch is only ahead);
// - 'fast-forward': the remote tip descends from HEAD, rebasing just moves the branch forward;
// - 'ask': the branches diverged (ahead = local commits to rebase), or the loaded part of the
//   graph cannot tell (ahead = null).
exports.pullPlan = (headNode, remoteNode, nodesById) => {
  if (!remoteNode) return { action: 'none', ahead: 0 };
  if (headNode && headNode.sha1 === remoteNode.sha1) return { action: 'none', ahead: 0 };
  if (!headNode || !headNode.isInited || !remoteNode.isInited)
    return { action: 'ask', ahead: null };
  // both tips are loaded, so "behind 0" and "ahead 0" are exact even on a partial history
  const counts = aheadBehind(headNode, remoteNode, nodesById);
  if (!counts) return { action: 'ask', ahead: null };
  if (counts.behind === 0) return { action: 'none', ahead: counts.ahead };
  if (counts.ahead === 0) return { action: 'fast-forward', ahead: 0 };
  return { action: 'ask', ahead: counts.ahead };
};

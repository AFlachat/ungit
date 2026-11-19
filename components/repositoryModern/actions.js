const components = require('ungit-components');
const { copyText } = require('./clipboard');
const {
  commitMenuItems,
  refMenuItems,
  dropMenuItems,
  escapeHtml,
} = require('../contextMenu/menuItems');

// Opens the context menus of the modern UI and runs the chosen item through the existing git
// actions. Every server call goes through repo.server; errors end up in unhandledRejection.
class ModernActions {
  constructor(repo) {
    this.repo = repo;
    this.dragRef = null;
  }

  get graph() {
    return this.repo.graph;
  }

  get server() {
    return this.repo.server;
  }

  _currentRemote() {
    return this.graph.currentRemote();
  }

  // ---- menus ----

  // The commit two steps behind the given one, or null.
  _grandparent(node) {
    const parent = this.graph.nodesById[node.parents()[0]];
    return parent ? this.graph.nodesById[parent.parents()[0]] || null : null;
  }

  openCommitMenu(x, y, node) {
    if (!node || !this.repo.contextMenu) return;
    const isHead = node === this.graph.HEAD();
    const currentBranch = this.graph.checkedOutBranch();
    const grandparent = isHead ? this._grandparent(node) : null;
    const items = commitMenuItems({
      sha1: node.sha1,
      isHead,
      currentBranch,
      hasParent: node.parents().length > 0,
      canSquash: !!(isHead && currentBranch && grandparent && grandparent.isInited),
      autoStash: this._autoStash(),
    });
    this.repo.contextMenu.open(x, y, items, (id) => this.run(id, { node }));
  }

  openRefMenu(x, y, ref) {
    if (!ref || !this.repo.contextMenu) return;
    const remote = this._currentRemote();
    const isCurrent = !!ref.isLocalBranch && ref.current();
    const remoteRef = ref.isLocalBranch ? ref.getRemoteRef(remote) : null;
    const node = ref.node();
    const remoteNode = remoteRef && remoteRef.node();
    const items = refMenuItems({
      name: ref.localRefName,
      isLocalBranch: !!ref.isLocalBranch,
      isRemoteBranch: !!ref.isRemoteBranch,
      isTag: !!ref.isTag,
      isCurrent,
      canBePushed: !!ref.canBePushed(remote),
      hasRemoteCounterpartBehind: !!(
        remoteNode &&
        node &&
        remoteNode !== node &&
        remoteNode.date < node.date
      ),
      currentBranch: this.graph.checkedOutBranch(),
      currentRemote: remote,
    });
    this.repo.contextMenu.open(x, y, items, (id) => this.run(id, { ref, node: ref.node() }));
  }

  openDropMenu(x, y, ref, node) {
    if (!ref || !node || !this.repo.contextMenu) return;
    const items = dropMenuItems({
      refName: ref.localRefName,
      targetSha1: node.sha1,
      isCurrentRef: !!ref.current(),
    });
    this.repo.contextMenu.open(x, y, items, (id) => this.run(id, { ref, node }));
  }

  _autoStash() {
    return ungit.config.autoStashAndPop !== false;
  }

  // Checks out a ref. A remote branch whose local branch exists checks out that local branch:
  // RefViewModel.checkout() would force-move it to the remote commit, orphaning local commits.
  checkoutRef(ref) {
    const local = ref.isRemoteBranch ? ref.getLocalRef() : null;
    return (local || ref).checkout();
  }

  // ---- drag & drop ----

  startDrag(ref, event) {
    this.dragRef = ref;
    if (event && event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData('text/plain', ref.localRefName);
      } catch {
        /* some browsers refuse setData in odd states: the drag still works through dragRef */
      }
    }
    const end = () => {
      document.removeEventListener('dragend', end, true);
      this.endDrag();
    };
    document.addEventListener('dragend', end, true);
  }

  endDrag() {
    this.dragRef = null;
    document.querySelectorAll('.modern-row.drop-target').forEach((r) => {
      r.classList.remove('drop-target');
    });
  }

  // ---- dispatcher ----

  async run(id, { node, ref } = {}) {
    // a graph action left waiting (e.g. a modal closed with "No") must not leak its context
    this.graph.currentActionContext(null);
    try {
      await this._run(id, node, ref);
    } catch (err) {
      if (err && err.errorCode === 'merge-failed') ungit.logger.warn(`${id} failed`, err);
      else this.server.unhandledRejection(err);
    }
  }

  _post(url, body) {
    return this.server.postPromise(url, Object.assign({ path: this.repo.repoPath() }, body));
  }

  _clip(text) {
    return copyText(text);
  }

  _askYes(title, details, onYes) {
    components.showModal('yesnomodal', {
      title,
      details,
      closeFunc: (isYes) => {
        if (isYes) {
          Promise.resolve()
            .then(onYes)
            .catch((e) => this.server.unhandledRejection(e));
        }
      },
    });
  }

  _createRef(node, title, label, method) {
    components.showModal('refnamemodal', {
      title,
      label,
      closeFunc: (name) => {
        if (!name) return;
        node.newBranchName(name);
        node[method]();
      },
    });
  }

  async _checkoutIfNeeded(ref) {
    if (ref.current()) return true;
    await ref.checkout();
    return !!ref.current(); // checkout() swallows its errors
  }

  async _run(id, node, ref) {
    const graph = this.graph;
    // the action classes come from the graph bundle: requiring them here would bundle copies
    const GraphActions = graph.actions;
    const checkedOutRef = graph.checkedOutRef();
    switch (id) {
      case 'checkout-commit':
        return this._post('/checkout', { name: node.sha1 });
      case 'create-branch':
        return this._createRef(node, 'Create new branch', 'Branch name', 'createBranch');
      case 'create-tag':
        return this._createRef(node, 'Create new tag', 'Tag name', 'createTag');
      case 'merge-commit':
        return this._post('/merge', { with: node.sha1 });
      case 'rebase-onto-commit':
        return graph.performAction(GraphActions.Rebase, node, checkedOutRef);
      case 'cherry-pick':
        return graph.performAction(GraphActions.CherryPick, node, node);
      case 'revert':
        return graph.performAction(GraphActions.Revert, node, node);
      case 'uncommit':
        return graph.performAction(GraphActions.Uncommit, node, node);
      case 'squash': {
        // "Squash with previous": HEAD and its parent become one staged change on the grandparent
        const grandparent = this._grandparent(node);
        if (!grandparent || !checkedOutRef) return;
        return graph.performAction(GraphActions.Squash, grandparent, checkedOutRef);
      }
      case 'reset-soft':
      case 'reset-mixed':
        return this._post('/reset', { to: node.sha1, mode: id.slice('reset-'.length) });
      case 'reset-hard': {
        const lost = this._autoStash()
          ? 'Commits after it will be lost; uncommitted changes are stashed and re-applied.'
          : 'Uncommitted changes and commits after it will be lost.';
        return this._askYes(
          'Are you sure?',
          `Reset ${escapeHtml(graph.checkedOutBranch() || 'HEAD')} to ${node.sha1.slice(0, 7)}? ${lost}`,
          () => this._post('/reset', { to: node.sha1, mode: 'hard' })
        );
      }
      case 'copy-sha':
        return this._clip(node.sha1);
      case 'copy-message':
        return this._clip(node.title());
      case 'copy-name':
        return this._clip(ref.localRefName);

      case 'checkout-ref':
        return this.checkoutRef(ref);
      case 'merge-ref':
        return graph.performAction(GraphActions.Merge, checkedOutRef.node(), ref);
      case 'rebase-onto-ref':
        return graph.performAction(GraphActions.Rebase, ref.node(), checkedOutRef);
      case 'push-ref':
        return graph.performAction(GraphActions.Push, ref.node(), ref);
      case 'reset-to-remote':
        return graph.performAction(GraphActions.Reset, ref.node(), ref);
      case 'delete-ref':
        return graph.performAction(GraphActions.Delete, ref.node(), ref);

      case 'move-ref':
        return ref.moveTo(node.sha1);
      case 'rebase-ref':
        if (!(await this._checkoutIfNeeded(ref))) return;
        return graph.performAction(GraphActions.Rebase, node, ref);
      case 'merge-into-ref':
        if (!(await this._checkoutIfNeeded(ref))) return;
        return this._post('/merge', { with: node.sha1 });
      default:
        throw new Error(`unknown context menu action: ${id}`);
    }
  }
}

module.exports = ModernActions;

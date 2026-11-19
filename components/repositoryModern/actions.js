const components = require('ungit-components');
const GraphActions = require('../graph/git-graph-actions');
const { commitMenuItems, refMenuItems, dropMenuItems } = require('../contextMenu/menuItems');

const { performAction } = GraphActions;

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

  openCommitMenu(x, y, node) {
    if (!node || !this.repo.contextMenu) return;
    const items = commitMenuItems({
      sha1: node.sha1,
      isHead: node === this.graph.HEAD(),
      currentBranch: this.graph.checkedOutBranch(),
      hasParent: node.parents().length > 0,
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
    return navigator.clipboard.writeText(text);
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
    if (!ref.current()) await ref.checkout();
  }

  async _run(id, node, ref) {
    const graph = this.graph;
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
        return performAction(graph, GraphActions.Rebase, node, checkedOutRef);
      case 'cherry-pick':
        return performAction(graph, GraphActions.CherryPick, node, node);
      case 'revert':
        return performAction(graph, GraphActions.Revert, node, node);
      case 'uncommit':
        return performAction(graph, GraphActions.Uncommit, node, node);
      case 'squash':
        return performAction(graph, GraphActions.Squash, node, checkedOutRef);
      case 'reset-soft':
      case 'reset-mixed':
        return this._post('/reset', { to: node.sha1, mode: id.slice('reset-'.length) });
      case 'reset-hard':
        return this._askYes(
          'Are you sure?',
          `Reset ${graph.checkedOutBranch() || 'HEAD'} to ${node.sha1.slice(0, 7)}? Uncommitted changes and commits after it will be lost.`,
          () => this._post('/reset', { to: node.sha1, mode: 'hard' })
        );
      case 'copy-sha':
        return this._clip(node.sha1);
      case 'copy-message':
        return this._clip(node.title());
      case 'copy-name':
        return this._clip(ref.localRefName);

      case 'checkout-ref':
        return ref.checkout();
      case 'merge-ref':
        return performAction(graph, GraphActions.Merge, checkedOutRef.node(), ref);
      case 'rebase-onto-ref':
        return performAction(graph, GraphActions.Rebase, ref.node(), checkedOutRef);
      case 'push-ref':
        return performAction(graph, GraphActions.Push, ref.node(), ref);
      case 'reset-to-remote':
        return performAction(graph, GraphActions.Reset, ref.node(), ref);
      case 'delete-ref':
        return performAction(graph, GraphActions.Delete, ref.node(), ref);

      case 'move-ref':
        return ref.moveTo(node.sha1);
      case 'rebase-ref':
        await this._checkoutIfNeeded(ref);
        return performAction(graph, GraphActions.Rebase, node, ref);
      case 'merge-into-ref':
        await this._checkoutIfNeeded(ref);
        return this._post('/merge', { with: node.sha1 });
      case 'reset-ref-to-commit':
        return this._askYes(
          'Are you sure?',
          `Reset ${ref.localRefName} to ${node.sha1.slice(0, 7)}? Commits after it will be lost.`,
          () => ref.moveTo(node.sha1, true)
        );
      default:
        throw new Error(`unknown context menu action: ${id}`);
    }
  }
}

module.exports = ModernActions;

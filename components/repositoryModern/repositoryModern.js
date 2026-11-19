const ko = require('knockout');
const octicons = require('octicons');
const components = require('ungit-components');
const programEvents = require('ungit-program-events');
const storage = require('ungit-storage');
const { editGitignore } = require('../repository/gitignore');
const ModernActions = require('./actions');

components.register(
  'repositoryModern',
  (args) => new RepositoryModernViewModel(args.server, args.path)
);

const LEFT = { key: 'modernLeftWidth', min: 160, max: 420, def: 230 };
const RIGHT = { key: 'modernRightWidth', min: 280, max: 640, def: 380 };
const clamp = (v, { min, max }) => Math.max(min, Math.min(max, v));
// a selection naming a commit (not WIP, a stash or nothing)
const isCommitSelection = (sel) =>
  typeof sel === 'string' && sel !== 'WIP' && !sel.startsWith('stash:');

class RepositoryModernViewModel {
  constructor(server, path) {
    this.server = server;
    this.isBareDir = path.status() === 'bare';
    this.repoPath = path.repoPath;
    this.gitErrors = components.create('gitErrors', { server, repoPath: this.repoPath });
    this.graph = components.create('graph', { server, repoPath: this.repoPath, headless: true });
    this.remotes = components.create('remotes', { server, repoPath: this.repoPath });
    this.submodules = components.create('submodules', { server, repoPath: this.repoPath });
    this.stash = this.isBareDir
      ? {}
      : components.create('stash', { server, repoPath: this.repoPath });
    this.staging = this.isBareDir
      ? {}
      : components.create('staging', { server, repoPath: this.repoPath, graph: this.graph });
    this.branches = components.create('branches', {
      server,
      graph: this.graph,
      repoPath: this.repoPath,
    });
    this.repoPath.subscribe((value) => {
      this.server.watchRepository(value);
    });
    this.server.watchRepository(this.repoPath());
    this.submodules.fetchSubmodules();

    // 'WIP', a sha1, 'stash:<..>' or null; commitList keeps it pointing at something that exists
    this.selection = ko.observable(null);
    // null | { name, oldName?, sha1 ('' for WIP), type: 'text'|'image' }
    this.activeFile = ko.observable(null);

    // The node of the selected commit, null when no commit is selected or while it is not loaded:
    // nodesById also holds placeholder nodes (isInited false) for ref targets and parents that are
    // past the loaded part of the history.
    this.selectedNode = ko.computed(() => {
      const sel = this.selection();
      if (!isCommitSelection(sel)) return null;
      this.graph.nodes(); // dependency: nodesById is a plain map, nodes() changes on every load
      const node = this.graph.nodesById[sel];
      return node && node.isInited ? node : null;
    });
    this.selectedCommitNotLoaded = ko.computed(
      () => isCommitSelection(this.selection()) && !this.selectedNode()
    );

    // files of the current selection, in the order the right panel shows them
    this.fileList = ko.computed(() => {
      const num = (v) => Number(String(v == null ? '' : v).replace(/[+-]/, '')) || 0;
      const sel = this.selection();
      if (sel === 'WIP') {
        const files = this.staging.files ? this.staging.files() : [];
        const mk = (f) => ({
          name: f.name(),
          oldName: f.oldName(),
          sha1: '',
          type: f.fileType(),
          additions: num(f.additions()),
          deletions: num(f.deletions()),
        });
        return [
          ...files.filter((f) => f.editState() !== 'staged'),
          ...files.filter((f) => f.editState() === 'staged'),
        ].map(mk);
      }
      if (typeof sel === 'string' && sel.startsWith('stash:')) {
        const sha1 = sel.slice('stash:'.length);
        const stashes = this.stash.stashedChanges ? this.stash.stashedChanges() : [];
        const stash = stashes.find((s) => s.sha1 === sha1);
        return (stash ? stash.commitDiff().commitLineDiffs : []).map((f) => ({
          name: f.fileName(),
          oldName: f.oldFileName(),
          sha1,
          type: f.fileType,
          additions: num(f.added()),
          deletions: num(f.removed()),
        }));
      }
      const node = this.selectedNode();
      const diffs = node && node.commitComponent ? node.commitComponent.fileLineDiffs() : null;
      return (diffs || []).map((f) => ({
        name: f.fileName,
        oldName: f.oldFileName,
        sha1: node.sha1,
        type: f.type,
        additions: num(f.additions),
        deletions: num(f.deletions),
      }));
    });
    // a diff whose file is no longer listed (committed, discarded, stash dropped...) is closed
    this.fileList.subscribe((files) => {
      const active = this.activeFile.peek();
      if (active && !files.some((f) => f.sha1 === active.sha1 && f.name === active.name)) {
        this.activeFile(null);
      }
    });

    this.isPulling = false;
    this.canPull = ko.computed(() => {
      this.graph.refs(); // dependency: remote refs are looked up in a plain map
      const ref = this.graph.checkedOutRef();
      const remote = this.remotes.currentRemote();
      if (!ref || !remote) return false;
      const remoteRef = ref.getRemoteRef(remote);
      if (!remoteRef) return false;
      remoteRef.node();
      return true;
    });
    this.canPush = ko.computed(() => {
      this.graph.refs(); // dependency: remote refs are looked up in a plain map
      const ref = this.graph.checkedOutRef();
      return !!(ref && ref.node() && ref.canBePushed(this.remotes.currentRemote()));
    });

    this.commitList = components.create('commitList', { repo: this });
    this.commitDetails = components.create('commitDetails', { repo: this });
    this.sidebar = components.create('sidebar', { repo: this });
    this.contextMenu = components.create('contextMenu', { repo: this });
    this.actions = new ModernActions(this);
    this.diffView = components.create('diffView', { repo: this });
    this.stagingPanel = this.isBareDir ? null : components.create('stagingPanel', { repo: this });

    this.fetchIcon = octicons.download.toSVG({ height: 16 });
    this.pullIcon = octicons['arrow-down'].toSVG({ height: 16 });
    this.pushIcon = octicons['arrow-up'].toSVG({ height: 16 });
    this.branchIcon = octicons['git-branch'].toSVG({ height: 16 });
    this.stashIcon = octicons.archive.toSVG({ height: 16 });
    this.ignoreIcon = octicons.file.toSVG({ height: 16 });
  }

  updateNode(parentElement) {
    ko.renderTemplate('repositoryModern', this, {}, parentElement);
    const main = parentElement.querySelector('.modern-main');
    if (main) {
      main.style.setProperty('--left', `${this.storedWidth(LEFT)}px`);
      main.style.setProperty('--right', `${this.storedWidth(RIGHT)}px`);
    }
  }

  storedWidth(spec) {
    const v = parseInt(storage.getItem(spec.key), 10);
    return Number.isFinite(v) ? clamp(v, spec) : spec.def;
  }

  selectCommit(sha1) {
    this.activeFile(null);
    this.selection(sha1);
  }

  selectWip() {
    this.activeFile(null);
    this.selection('WIP');
  }

  openFile(file) {
    this.activeFile(file);
  }

  closeDiff() {
    this.activeFile(null);
  }

  // Loads one more page of history, e.g. to reach a selected commit that is not loaded yet.
  loadMoreCommits() {
    this.graph.limit(this.graph.limit() + ungit.config.numberOfNodesPerLoad);
    this.graph.loadNodesFromApi();
  }

  fetch() {
    return this.remotes.fetch({ nodes: true, tags: true });
  }

  async pull() {
    if (this.isPulling) return;
    this.isPulling = true;
    try {
      await this.remotes.fetch({ nodes: true, tags: true });
      const ref = this.graph.checkedOutRef();
      if (!ref) return;
      const remoteRef = ref.getRemoteRef(this.remotes.currentRemote());
      if (!remoteRef || remoteRef.node() === this.graph.HEAD()) return;
      await this.server.postPromise('/rebase', {
        path: this.repoPath(),
        onto: remoteRef.localRefName,
      });
    } catch (err) {
      if (err.errorCode !== 'merge-failed') this.server.unhandledRejection(err);
      else ungit.logger.warn('pull (rebase) failed', err);
    } finally {
      this.isPulling = false;
    }
  }

  push() {
    const ref = this.graph.checkedOutRef();
    if (!ref || !ref.canBePushed(this.remotes.currentRemote())) return;
    return this.graph.performAction(this.graph.actions.Push, ref.node(), ref);
  }

  createBranch() {
    const head = this.graph.HEAD();
    if (!head) return;
    components.showModal('refnamemodal', {
      title: 'Create new branch',
      label: 'Branch name',
      closeFunc: (name) => {
        if (!name) return;
        this.server
          .postPromise('/branches', { path: this.repoPath(), name, sha1: head.sha1 })
          .then(() => programEvents.dispatch({ event: 'branch-updated' }))
          .catch((e) => this.server.unhandledRejection(e));
      },
    });
  }

  stashAll() {
    if (this.staging.stashAll) return this.staging.stashAll();
  }

  editGitignore() {
    return editGitignore(this.server, this.repoPath);
  }

  startDrag(data, e) {
    const gutter = e.currentTarget;
    const main = gutter.parentElement;
    const isLeft = gutter.dataset.side === 'left';
    const spec = isLeft ? LEFT : RIGHT;
    const prop = isLeft ? '--left' : '--right';
    e.preventDefault();
    gutter.classList.add('drag');
    let width = this.storedWidth(spec);
    const move = (ev) => {
      const rect = main.getBoundingClientRect();
      const raw = isLeft ? ev.clientX - rect.left : rect.right - ev.clientX;
      width = Math.round(clamp(raw, spec));
      main.style.setProperty(prop, `${width}px`);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      gutter.classList.remove('drag');
      storage.setItem(spec.key, width);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return false;
  }

  onProgramEvent(event) {
    if (this.gitErrors.onProgramEvent) this.gitErrors.onProgramEvent(event);
    if (this.graph.onProgramEvent) this.graph.onProgramEvent(event);
    if (this.staging.onProgramEvent) this.staging.onProgramEvent(event);
    if (this.stash.onProgramEvent) this.stash.onProgramEvent(event);
    if (this.remotes.onProgramEvent) this.remotes.onProgramEvent(event);
    if (this.submodules.onProgramEvent) this.submodules.onProgramEvent(event);
    if (this.branches.onProgramEvent) this.branches.onProgramEvent(event);
    if (this.commitList.onProgramEvent) this.commitList.onProgramEvent(event);
    if (event.event == 'connected') this.server.watchRepository(this.repoPath());
  }

  updateAnimationFrame(deltaT) {
    if (this.graph.updateAnimationFrame) this.graph.updateAnimationFrame(deltaT);
  }
}

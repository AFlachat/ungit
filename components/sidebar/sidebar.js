const ko = require('knockout');
const octicons = require('octicons');
const components = require('ungit-components');
const storage = require('ungit-storage');
const { aheadBehind } = require('./aheadBehind');

components.register('sidebar', (args) => new SidebarViewModel(args));

const STORAGE_KEY = 'modernSidebarClosed';

const SECTIONS = [
  { id: 'local', title: 'LOCAL' },
  { id: 'remote', title: 'REMOTE' },
  { id: 'tags', title: 'TAGS' },
  { id: 'stashes', title: 'STASHES' },
  { id: 'submodules', title: 'SUBMODULES' },
];

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

class SidebarViewModel {
  constructor({ repo }) {
    this.repo = repo;
    this.filter = ko.observable('');
    this.filterIcon = octicons.search.toSVG({ height: 12 });
    this.icons = {
      local: octicons['git-branch'].toSVG({ height: 14 }),
      remote: octicons['git-branch'].toSVG({ height: 14 }),
      tags: octicons.tag.toSVG({ height: 14 }),
      stashes: octicons.archive.toSVG({ height: 14 }),
      submodules: octicons['file-submodule'].toSVG({ height: 14 }),
    };
    this.closed = ko.observableArray(this._loadClosed());
    this.closed.subscribe((v) => {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(v));
      } catch {
        /* storage unavailable: the state is just not persisted */
      }
    });

    // sorted refs by kind; only rebuilt when refs are added or removed
    this._refItems = ko.computed(() => {
      const items = { local: [], remote: [], tags: [] };
      for (const ref of this.repo.graph.refs()) {
        if (ref.isLocalBranch) items.local.push(this._refItem(ref, 'local'));
        else if (ref.isRemoteBranch) items.remote.push(this._refItem(ref, 'remote'));
        else if (ref.isLocalTag) items.tags.push(this._refItem(ref, 'tags'));
      }
      for (const k in items) items[k].sort(byName);
      return items;
    });

    const groupsOf = ko.pureComputed(() => {
      const q = this.filter().trim().toLowerCase();
      const match = (item) => !q || item.name.toLowerCase().includes(q);
      const refs = this._refItems();
      const stashes = this._list(this.repo.stash && this.repo.stash.stashedChanges).map((s) =>
        this._stashItem(s)
      );
      const subs = this._list(this.repo.submodules && this.repo.submodules.submodules).map((s) =>
        this._submoduleItem(s)
      );
      const flat = (items) => [{ name: null, items: items.filter(match) }];
      const remote = [];
      for (const item of refs.remote.filter(match)) {
        let g = remote.find((x) => x.name === item.ref.remote);
        if (!g) remote.push((g = { name: item.ref.remote, items: [] }));
        g.items.push(item);
      }
      return {
        local: flat(refs.local),
        remote,
        tags: flat(refs.tags),
        stashes: flat(stashes),
        submodules: flat(subs),
      };
    });
    // stable section objects: only their groups and counts change
    this.sections = SECTIONS.map((s) => {
      const groups = ko.pureComputed(() => groupsOf()[s.id]);
      return {
        id: s.id,
        title: s.title,
        icon: this.icons[s.id],
        groups,
        count: ko.pureComputed(() => groups().reduce((n, g) => n + g.items.length, 0)),
        closed: ko.pureComputed(() => this.closed().includes(s.id)),
      };
    });

    // a stash that disappeared (applied+dropped, or dropped elsewhere) must not stay selected
    this._stashFallback = ko.computed(() => {
      const stashes = this.repo.stash && this.repo.stash.stashedChanges;
      if (!stashes) return;
      const list = stashes();
      const sel = this.repo.selection.peek();
      if (typeof sel !== 'string' || !sel.startsWith('stash:')) return;
      const sha1 = sel.slice('stash:'.length);
      if (list.some((s) => s.sha1 === sha1)) return;
      const active = this.repo.activeFile.peek();
      if (active && active.sha1 === sha1) this.repo.closeDiff();
      const head = this.repo.graph.HEAD.peek();
      this.repo.selection(head ? head.sha1 : null);
    });
    // the stash may also vanish from under an already selected row without the list changing
    this.repo.selection.subscribe((sel) => {
      if (typeof sel === 'string' && sel.startsWith('stash:'))
        this._stashFallback.evaluateImmediate();
    });
  }

  // the value of an observable that should hold an array (the server answers {} when empty)
  _list(observable) {
    const v = observable ? observable() : [];
    return Array.isArray(v) ? v : [];
  }

  _loadClosed() {
    try {
      const v = JSON.parse(storage.getItem(STORAGE_KEY));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  _refItem(ref, kind) {
    const isLocal = kind === 'local';
    const badge = ko.pureComputed(() => (isLocal ? this._aheadBehind(ref) : null));
    return {
      kind,
      ref,
      name: ref.localRefName,
      title: ref.localRefName,
      current: isLocal ? ref.current : false,
      draggable: isLocal,
      badge,
      sub: kind === 'remote',
    };
  }

  _stashItem(stash) {
    return {
      kind: 'stashes',
      stash,
      name: String(stash.id),
      title: stash.message || stash.title,
      label: stash.message || stash.title,
      draggable: false,
      sub: false,
      badge: null,
      current: ko.pureComputed(() => this.repo.selection() === `stash:${stash.sha1}`),
    };
  }

  _submoduleItem(submodule) {
    return {
      kind: 'submodules',
      submodule,
      name: submodule.name,
      title: submodule.path,
      current: false,
      draggable: false,
      sub: false,
      badge: null,
    };
  }

  // { ahead, behind } against the current remote's copy of the branch; null while unknown
  _aheadBehind(ref) {
    this.repo.graph.nodes(); // dependency: nodesById is a plain map
    this.repo.graph.refs();
    const remote = this.repo.remotes.currentRemote();
    if (!remote) return null;
    const remoteRef = ref.getRemoteRef(remote);
    const node = ref.node();
    const remoteNode = remoteRef && remoteRef.node();
    if (!node || !remoteNode || node === remoteNode) return null;
    const counts = aheadBehind(node, remoteNode, this.repo.graph.nodesById);
    if (!counts || (!counts.ahead && !counts.behind)) return null;
    return counts;
  }

  toggleSection(section) {
    if (this.closed.indexOf(section.id) >= 0) this.closed.remove(section.id);
    else this.closed.push(section.id);
  }

  activate(item) {
    if (item.stash) {
      this.repo.activeFile(null);
      this.repo.selection(`stash:${item.stash.sha1}`);
    } else if (item.ref) {
      const node = item.ref.node();
      if (!node) return;
      this.repo.selectCommit(node.sha1);
      this.repo.commitList.scrollTo(node.sha1);
    } else if (item.submodule) {
      this.repo.submodules.submodulePathClick(item.submodule);
    }
  }

  open(item) {
    if (item.ref) item.ref.checkout();
  }

  updateNode(parentElement) {
    ko.renderTemplate('sidebar', this, {}, parentElement);
  }
}

module.exports = SidebarViewModel;

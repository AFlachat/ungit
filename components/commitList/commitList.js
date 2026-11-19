const ko = require('knockout');
const components = require('ungit-components');
const { computeLanes, laneColor } = require('./lanes');

components.register('commitList', (args) => new CommitListViewModel(args));

const H = 28; // row height, keep in sync with @modern-row-h
const LW = 16; // lane spacing
const PAD = 10;
const BUFFER = 10; // extra rows rendered above and below the viewport
const NEAR_END = 300; // px from the bottom that triggers loading more
const FALLBACK_VIEWPORT = 600;
const AVATAR_COLORS = ['#4c9aff', '#a371f7', '#3fb950', '#f0883e', '#db61a2', '#d29922', '#2dbbb0'];

const lx = (l) => PAD + l * LW;
const escapeXml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );

const initialsOf = (name) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0];
  return letters.toUpperCase();
};

const hashString = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const lanesSvg = (row, width) => {
  const { dot, up, down, pass } = row.lanes;
  const mid = H / 2;
  const stroke = (color, extra = '') => `stroke="${color}" stroke-width="2" fill="none" ${extra}`;
  let p = '';
  pass.forEach((l) => (p += `<path d="M${lx(l)} 0 V${H}" ${stroke(laneColor(l))}/>`));
  up.forEach((l) => {
    p +=
      l === dot
        ? `<path d="M${lx(l)} 0 V${mid}" ${stroke(laneColor(l))}/>`
        : `<path d="M${lx(l)} 0 C${lx(l)} ${mid} ${lx(dot)} ${mid * 0.6} ${lx(dot)} ${mid}" ${stroke(laneColor(l))}/>`;
  });
  down.forEach((l) => {
    p +=
      l === dot
        ? `<path d="M${lx(l)} ${mid} V${H}" ${stroke(laneColor(l), row.wip ? 'stroke-dasharray="3 3"' : '')}/>`
        : `<path d="M${lx(dot)} ${mid} C${lx(dot)} ${H * 0.85} ${lx(l)} ${mid} ${lx(l)} ${H}" ${stroke(laneColor(Math.max(l, dot)))}/>`;
  });
  const col = laneColor(dot);
  if (row.wip) {
    p += `<circle cx="${lx(dot)}" cy="${mid}" r="6" fill="#1b1d23" stroke="${col}" stroke-width="2" stroke-dasharray="3 2"/>`;
  } else if (row.parents.length > 1) {
    p += `<circle cx="${lx(dot)}" cy="${mid}" r="4" fill="${col}"/>`;
  } else {
    p += `<circle cx="${lx(dot)}" cy="${mid}" r="7" fill="${col}"/><text x="${lx(dot)}" y="${mid + 3}" font-size="7" font-weight="700" text-anchor="middle" fill="#fff">${escapeXml(row.initials.charAt(0))}</text>`;
  }
  return `<svg class="modern-lanes" width="${width}" height="${H}">${p}</svg>`;
};

class Row {
  constructor(sha1, node, parents, lanes, list) {
    this.sha1 = sha1; // 'WIP' for the working-tree row
    this.node = node;
    this.parents = parents;
    this.laneData = ko.observable(lanes);
    this.wip = sha1 === 'WIP';
    this.list = list;
  }

  get lanes() {
    return this.laneData();
  }

  // Row instances are reused across refreshes (identity keeps foreach from re-rendering).
  update(node, parents, lanes) {
    this.node = node;
    this.parents = parents;
    if (JSON.stringify(this.laneData.peek()) !== JSON.stringify(lanes)) this.laneData(lanes);
  }

  // The getters below are read from bindings, so only rendered rows subscribe to node data.
  get title() {
    if (this.wip) {
      const n = this.list.wipFileCount();
      return `// WIP — ${n} changed file${n === 1 ? '' : 's'}`;
    }
    return this.node.title();
  }

  get authorName() {
    return this.node ? this.node.commitComponent.authorName() : '';
  }

  get initials() {
    return initialsOf(this.authorName);
  }

  get avatarColor() {
    const key = this.node ? this.node.commitComponent.authorEmail() || this.authorName : '';
    return AVATAR_COLORS[hashString(key || '') % AVATAR_COLORS.length];
  }

  get date() {
    return this.node ? this.node.commitComponent.authorDateFromNow() : 'now';
  }

  get shortSha() {
    return this.node ? this.sha1.slice(0, 7) : '';
  }

  get refs() {
    if (!this.node) return [];
    const color = laneColor(this.lanes.dot);
    return this.node
      .branches()
      .concat(this.node.tags())
      .map((ref) => {
        const tag = !!ref.isTag;
        const remote = !!ref.isRemoteBranch || !!ref.isRemoteTag;
        const current = !!ref.isLocalBranch && ref.current();
        const c = tag ? '#d29922' : remote ? '#8b92a0' : color;
        return {
          ref,
          name: ref.localRefName,
          tag,
          remote,
          current,
          draggable: !!ref.isLocalBranch,
          color: c,
          borderColor: `${c}66`,
          background: current ? `${c}33` : 'transparent',
        };
      });
  }

  get svg() {
    return lanesSvg(this, this.list.lanesWidth());
  }
}

class CommitListViewModel {
  constructor({ repo }) {
    this.repo = repo;
    this.select = this.select.bind(this); // used as a click handler inside foreach
    ['onContextMenu', 'onDragStart', 'onDragOver', 'onDragLeave', 'onDrop'].forEach((k) => {
      this[k] = this[k].bind(this);
    });
    this.rowHeight = H;
    this.scrollTop = ko.observable(0);
    this.viewportHeight = ko.observable(0);

    this._rowCache = new Map(); // sha1 | 'WIP' -> Row
    this.wipFileCount = ko.computed(() => this._wipFiles().length);
    this.hasWip = ko.computed(() => !repo.isBareDir && this.wipFileCount() > 0);

    this.rows = ko.computed(() => {
      const graph = repo.graph;
      const nodes = graph.nodes();
      const head = graph.HEAD();
      const entries = nodes.map((node) => ({ sha1: node.sha1, parents: node.parents(), node }));
      if (this.hasWip()) {
        entries.unshift({ sha1: 'WIP', parents: head ? [head.sha1] : [], node: null });
      }
      const lanes = computeLanes(entries);
      const cache = this._rowCache;
      const seen = new Set();
      const result = entries.map((e, i) => {
        seen.add(e.sha1);
        let row = cache.get(e.sha1);
        if (row) row.update(e.node, e.parents, lanes[i]);
        else cache.set(e.sha1, (row = new Row(e.sha1, e.node, e.parents, lanes[i], this)));
        return row;
      });
      for (const sha of cache.keys()) if (!seen.has(sha)) cache.delete(sha);
      return result;
    });

    this.lanesWidth = ko.computed(() => {
      const w = this.rows().reduce((max, r) => Math.max(max, r.lanes.width), 1);
      return PAD * 2 + (w - 1) * LW;
    });
    this.firstColumnWidth = ko.computed(() =>
      Math.min(480, Math.max(200, this.lanesWidth() + 110))
    );

    this.window = ko.computed(() => {
      const total = this.rows().length;
      const vh = this.viewportHeight() || FALLBACK_VIEWPORT;
      const start = Math.max(0, Math.floor(this.scrollTop() / H) - BUFFER);
      const end = Math.min(total, Math.ceil((this.scrollTop() + vh) / H) + BUFFER);
      return { start: Math.min(start, end), end };
    });
    this.visibleRows = ko.computed(() => {
      const { start, end } = this.window();
      return this.rows().slice(start, end);
    });
    this.topSpacer = ko.computed(() => this.window().start * H);
    this.bottomSpacer = ko.computed(() => (this.rows().length - this.window().end) * H);

    this._defaultSelection = ko.computed(() => this._applyDefaultSelection());
    // a selection that becomes null is re-defaulted at once, not on the next graph change
    repo.selection.subscribe((sel) => {
      if (sel == null) ko.ignoreDependencies(() => this._applyDefaultSelection());
    });
    // Fill the viewport when the loaded commits do not reach the bottom yet. Only when the length
    // changed: a reload with the same commits must not trigger yet another load (endless loop).
    let lastLength = 0;
    this.rows.subscribe((rows) => {
      if (rows.length === lastLength) return;
      lastLength = rows.length;
      setTimeout(() => this._loadMoreIfNearEnd(), 0);
    });
    // Out of order /gitlog answers can leave an older, shorter page of history loaded last: the
    // short page looks like the end of history, so reload it at the current limit.
    let lastNodeCount = 0;
    repo.graph.nodes.subscribe((nodes) => {
      const graph = repo.graph;
      if (nodes.length < lastNodeCount && nodes.length < graph.limit.peek()) {
        graph.loadNodesFromApi();
      }
      lastNodeCount = nodes.length;
    });
  }

  // Right-click on a ref pill opens the ref menu, anywhere else on a commit row the commit menu.
  onContextMenu(row, event) {
    if (row.wip) return false;
    const pillEl = event.target.closest && event.target.closest('.modern-ref');
    const pill = pillEl && ko.dataFor(pillEl);
    if (pill && pill.ref) this.repo.actions.openRefMenu(event.clientX, event.clientY, pill.ref);
    else this.repo.actions.openCommitMenu(event.clientX, event.clientY, row.node);
    return false;
  }

  onDragStart(row, event) {
    const pillEl = event.target.closest && event.target.closest('.modern-ref[draggable="true"]');
    const pill = pillEl && ko.dataFor(pillEl);
    if (!pill || !pill.ref) return true;
    this.repo.actions.startDrag(pill.ref, event);
    return true; // the default action starts the drag
  }

  onDragOver(row, event) {
    const dragRef = this.repo.actions.dragRef;
    if (!dragRef || row.wip || row.node === dragRef.node()) return true;
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drop-target');
    return false; // preventDefault: this row accepts the drop
  }

  onDragLeave(row, event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      event.currentTarget.classList.remove('drop-target');
    }
    return true;
  }

  onDrop(row, event) {
    const actions = this.repo.actions;
    const ref = actions.dragRef;
    if (!ref || row.wip) return true;
    actions.endDrag();
    if (row.node === ref.node()) return false; // dropping on its own commit does nothing
    actions.openDropMenu(event.clientX, event.clientY, ref, row.node);
    return false;
  }

  _wipFiles() {
    const files = this.repo.staging && this.repo.staging.files;
    return files ? files() : [];
  }

  // Keeps repo.selection pointing at something that exists.
  _applyDefaultSelection() {
    const repo = this.repo;
    const nodes = repo.graph.nodes();
    const head = repo.graph.HEAD();
    const hasWip = this.hasWip();
    const current = repo.selection.peek();
    if (typeof current === 'string' && current.startsWith('stash:')) return;
    const headSha = head ? head.sha1 : null;
    const fallback = () => headSha || (hasWip ? 'WIP' : null);

    if (current === 'WIP') {
      if (!hasWip) repo.selection(headSha);
    } else if (current) {
      // A commit stays selected while it is listed, or while it is not loaded yet (placeholder
      // node: the details panel offers to load it). nodesById is never pruned, so a loaded node
      // that left the list was rewritten (uncommit, amend, reset, rebase...): replace it.
      const node = repo.graph.nodesById[current];
      if (!node || (node.isInited && !nodes.includes(node))) {
        // Wait until something can be selected, a not yet loaded graph must not reset anything.
        if (headSha || nodes.length) {
          repo.selection(headSha);
          repo.closeDiff();
        }
      }
    } else {
      const sel = fallback();
      if (sel) repo.selection(sel);
    }
  }

  isSelected(row) {
    return this.repo.selection() === row.sha1;
  }

  select(row) {
    if (row.wip) this.repo.selectWip();
    else this.repo.selectCommit(row.sha1);
  }

  updateNode(parentElement) {
    // parentElement may be a virtual (comment) element, so work on the rendered nodes instead.
    ko.renderTemplate(
      'commitList',
      this,
      {
        afterRender: (nodes) => {
          const root = nodes.find(
            (n) => n.nodeType === 1 && n.classList.contains('modern-commit-list')
          );
          if (root) this._attach(root);
        },
      },
      parentElement
    );
  }

  _attach(root) {
    const el = root.querySelector('.modern-rows');
    this.rowsEl = el;
    let wasHidden = false;
    const measure = () => {
      // hidden (display: none) while a diff is open: measure nothing, load nothing
      if (!el.clientHeight) {
        wasHidden = true;
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        el.scrollTop = this.scrollTop(); // the browser may have reset it
      }
      this.viewportHeight(el.clientHeight);
      this._loadMoreIfNearEnd();
    };
    measure();
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    const onKey = (e) => this.onKeyDown(e);
    document.addEventListener('keydown', onKey);
    ko.utils.domNodeDisposal.addDisposeCallback(root, () => {
      document.removeEventListener('keydown', onKey);
      if (observer) observer.disconnect();
      if (this.rowsEl === el) this.rowsEl = null;
    });
  }

  onScroll(data, event) {
    const el = event.target;
    if (!el.clientHeight) return;
    this.scrollTop(el.scrollTop);
    this._loadMoreIfNearEnd();
  }

  _loadMoreIfNearEnd() {
    const el = this.rowsEl;
    if (!el || !el.clientHeight || !this.rows().length) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight >= NEAR_END) return;
    // a page shorter than the limit means the end of history was reached: nothing more to load
    const graph = this.repo.graph;
    if (graph.nodes.peek().length >= graph.limit.peek()) graph.scrolledToEnd();
  }

  onKeyDown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (this.repo.activeFile()) return; // arrows belong to the diff view while it is open
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.modal-dialog')) return;
    const rows = this.rows();
    if (!rows.length) return;
    const selected = this.repo.selection();
    const i = rows.findIndex((r) => r.sha1 === selected);
    const next =
      rows[
        Math.max(0, Math.min(rows.length - 1, i === -1 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))
      ];
    e.preventDefault();
    this.select(next);
    this._scrollIntoView(rows.indexOf(next));
  }

  // Scrolls the row of a commit into view; does nothing for a commit that is not loaded.
  scrollTo(sha1) {
    const index = this.rows().findIndex((r) => r.sha1 === sha1);
    if (index >= 0) this._scrollIntoView(index);
  }

  _scrollIntoView(index) {
    const el = this.rowsEl;
    if (!el) return;
    const top = index * H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + H > el.scrollTop + el.clientHeight) el.scrollTop = top + H - el.clientHeight;
  }
}

module.exports = CommitListViewModel;

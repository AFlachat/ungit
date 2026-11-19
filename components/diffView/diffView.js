const ko = require('knockout');
const components = require('ungit-components');
const storage = require('ungit-storage');

components.register('diffView', (args) => new DiffViewViewModel(args));

const MODES = ['hunk', 'inline', 'split'];
const KEY = 'modernDiffMode';

class DiffViewViewModel {
  constructor(args) {
    this.repo = args.repo;
    const stored = storage.getItem(KEY);
    this.mode = ko.observable(MODES.includes(stored) ? stored : 'hunk');
    this.mode.subscribe((m) => storage.setItem(KEY, m));
    this.whiteSpace = components.create('textdiff.whitespace');
    this.wordWrap = components.create('textdiff.wordwrap');

    this.diff = ko.computed(() => {
      // a replaced diff must stop reacting to the shared whitespace/wrap toggles
      const prev = ko.ignoreDependencies(() => this.diff && this.diff.peek());
      if (prev) {
        prev.isShowingDiffs(false);
        if (prev.dispose) prev.dispose();
      }
      const file = this.repo.activeFile();
      const mode = this.mode();
      if (!file) return null;
      return ko.ignoreDependencies(() => {
        const diffArgs = {
          filename: file.name,
          oldFilename: file.oldName || file.name,
          repoPath: this.repo.repoPath,
          server: this.repo.server,
          sha1: file.sha1,
          isShowingDiffs: ko.observable(true),
          textDiffType: { value: ko.observable(mode === 'split' ? 'sidebysidediff' : 'textdiff') },
          whiteSpace: this.whiteSpace,
          wordWrap: this.wordWrap,
          contextLines: mode === 'inline' ? 1000000 : undefined,
        };
        return components.create(file.type === 'image' ? 'imagediff' : 'textdiff', diffArgs);
      });
    });

    this.current = ko.computed(() => {
      const f = this.repo.activeFile();
      if (!f) return null;
      return this.repo.fileList().find((x) => x.name === f.name && x.sha1 === f.sha1) || null;
    });
    this.dirName = ko.computed(() => {
      const f = this.repo.activeFile();
      const i = f ? f.name.lastIndexOf('/') : -1;
      return i >= 0 ? f.name.slice(0, i + 1) : '';
    });
    this.baseName = ko.computed(() => {
      const f = this.repo.activeFile();
      return f ? f.name.slice(f.name.lastIndexOf('/') + 1) : '';
    });
    this.additions = ko.computed(() => (this.current() ? this.current().additions : 0));
    this.deletions = ko.computed(() => (this.current() ? this.current().deletions : 0));
  }

  updateNode(parentElement) {
    ko.renderTemplate(
      'diffView',
      this,
      {
        afterRender: (nodes) => {
          const root = nodes.find((n) => n.nodeType === 1);
          if (!root) return;
          const onKey = (e) => this.onKeyDown(e);
          document.addEventListener('keydown', onKey);
          ko.utils.domNodeDisposal.addDisposeCallback(root, () =>
            document.removeEventListener('keydown', onKey)
          );
        },
      },
      parentElement
    );
  }

  close() {
    this.repo.closeDiff();
  }

  onKeyDown(e) {
    if (!this.repo.activeFile()) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.modal-dialog')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const list = this.repo.fileList();
      const f = this.repo.activeFile();
      const i = list.findIndex((x) => x.name === f.name && x.sha1 === f.sha1);
      if (i === -1) return;
      const next = list[i + (e.key === 'ArrowDown' ? 1 : -1)];
      e.preventDefault();
      if (next)
        this.repo.openFile({
          name: next.name,
          oldName: next.oldName,
          sha1: next.sha1,
          type: next.type,
        });
    }
  }
}

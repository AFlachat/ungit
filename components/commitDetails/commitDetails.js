const ko = require('knockout');
const components = require('ungit-components');
const { bar5, initialsOf } = require('../repositoryModern/fileUtils');

components.register('commitDetails', (args) => new CommitDetailsViewModel(args));

class CommitDetailsViewModel {
  constructor(args) {
    this.repo = args.repo;
    this.avatarFailed = ko.observable(false);
    // the node of the selected commit, null while it is not loaded (or when WIP/stash is selected)
    this.node = ko.computed(() => {
      this.repo.graph.nodes(); // dependency: nodesById is a plain map
      const sel = this.repo.selection();
      return sel && sel !== 'WIP' ? this.repo.graph.nodesById[sel] || null : null;
    });
    // the stash selected as 'stash:<sha1>', null otherwise
    this.stash = ko.computed(() => {
      const sel = this.repo.selection();
      if (typeof sel !== 'string' || !sel.startsWith('stash:')) return null;
      const stashes = this.repo.stash.stashedChanges ? this.repo.stash.stashedChanges() : [];
      return stashes.find((s) => `stash:${s.sha1}` === sel) || null;
    });
    this.commit = ko.computed(() => (this.node() ? this.node().commitComponent : null));
    this.node.subscribe(() => this.avatarFailed(false));
  }

  updateNode(parentElement) {
    ko.renderTemplate('commitDetails', this, {}, parentElement);
  }

  isMerge(commit) {
    return (commit.parents() || []).length > 1;
  }

  shortSha(sha1) {
    return sha1.slice(0, 7);
  }

  initials(commit) {
    return initialsOf(commit.authorName());
  }

  gravatarUrl(commit) {
    return `https://www.gravatar.com/avatar/${commit.authorGravatar()}?default=404`;
  }

  authorDateText(commit) {
    const d = commit.authorDate();
    return d ? `authored ${commit.authorDateFromNow()} · ${d.format('YYYY-MM-DD HH:mm')}` : '';
  }

  files(commit) {
    return (commit.fileLineDiffs() || []).map((f) => ({
      fileName: f.fileName,
      oldFileName: f.oldFileName,
      displayName: f.displayName || f.fileName,
      type: f.type,
      additions: f.additions,
      deletions: f.deletions,
      bar: bar5(f.additions, f.deletions),
    }));
  }

  stashFiles(stash) {
    return stash.commitDiff().commitLineDiffs.map((f) => ({
      fileName: f.fileName(),
      oldFileName: f.oldFileName(),
      displayName: f.displayName() || f.fileName(),
      type: f.fileType,
      additions: f.added(),
      deletions: f.removed(),
      bar: bar5(f.added(), f.removed()),
    }));
  }

  // sha1 of what the right panel shows: the commit or the stash
  currentSha() {
    const stash = this.stash();
    return stash ? stash.sha1 : this.node().sha1;
  }

  isActive(file) {
    const active = this.repo.activeFile();
    return !!active && active.sha1 === this.currentSha() && active.name === file.fileName;
  }

  openFile(file) {
    this.repo.openFile({
      name: file.fileName,
      oldName: file.oldFileName,
      sha1: this.currentSha(),
      type: file.type,
    });
  }

  gotoParent(sha1) {
    this.repo.selectCommit(sha1);
  }

  copySha(commit) {
    commit.copyHash();
  }
}

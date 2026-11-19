const ko = require('knockout');
const components = require('ungit-components');
const { bar5 } = require('../repositoryModern/fileUtils');

components.register('stagingPanel', (args) => new StagingPanelViewModel(args));

class StagingPanelViewModel {
  constructor(args) {
    this.repo = args.repo;
    this.staging = args.repo.staging;
    const files = () => (this.staging.files ? this.staging.files() : []);
    this.stagedFiles = ko.computed(() => files().filter((f) => f.editState() === 'staged'));
    this.unstagedFiles = ko.computed(() => files().filter((f) => f.editState() !== 'staged'));
    this.hasFiles = ko.computed(() => files().length > 0);
    this.branchName = ko.computed(() => {
      return this.repo.graph.checkedOutBranch ? this.repo.graph.checkedOutBranch() || '' : '';
    });
    this.commitLabel = ko.computed(() => {
      const n = this.stagedFiles().length;
      return this.staging.amend()
        ? 'Amend commit'
        : `Commit changes to ${n} file${n === 1 ? '' : 's'}`;
    });
  }

  updateNode(parentElement) {
    ko.renderTemplate('stagingPanel', this, {}, parentElement);
  }

  status(file) {
    if (file.conflict()) return 'U';
    if (file.isNew()) return 'A';
    if (file.removed()) return 'D';
    return 'M';
  }

  bar(file) {
    return bar5(file.additions().replace('+', ''), file.deletions().replace('-', ''));
  }

  isActive(file) {
    const active = this.repo.activeFile();
    return !!active && active.sha1 === '' && active.name === file.name();
  }

  openFile(file) {
    this.repo.openFile({
      name: file.name(),
      oldName: file.oldName(),
      sha1: '',
      type: file.fileType(),
    });
  }

  toggleFile(file) {
    file.toggleStaged();
    return true; // let the checkbox keep its native toggle, the checked binding re-syncs it
  }

  stageAll() {
    this.staging.files().forEach((f) => f.editState('staged'));
  }

  unstageAll() {
    this.staging.files().forEach((f) => f.editState('none'));
  }

  discardAll() {
    this.staging.discardAllChanges();
  }

  discardFile(file) {
    file.discardChanges();
  }

  toggleAmend() {
    this.staging.toggleAmend();
    return true;
  }

  commit() {
    if (!this.staging.commitValidationError()) this.staging.commit();
  }

  conflictContinue() {
    if (this.staging.conflictContinue) this.staging.conflictContinue.call(this.staging);
  }

  conflictAbort() {
    if (this.staging.conflictAbort) this.staging.conflictAbort.call(this.staging);
  }
}

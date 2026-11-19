'use strict';
const { execFileSync } = require('child_process');
const environment = require('./environment')({ serverStartupOptions: ['--ui=modern'] });
const testRepoPaths = [];

describe('[MODERN] shell', () => {
  const pageErrors = [];

  before('Environment init', async function () {
    this.timeout(240000);
    await environment.init();
    await environment.createRepos(testRepoPaths, [
      { bare: false },
      { bare: true },
      { bare: false, initCommits: 3 },
      { bare: false, initCommits: 150 },
      { bare: false }, // 4: empty repository
      { bare: false, initCommits: 3 }, // 5: right panel
      { bare: false, initCommits: 1 }, // 6: merge conflict
      { bare: false }, // 7: diff view
    ]);
  });

  after('Environment stop', () => environment.shutdown());

  it('opens a repository in modern layout', async () => {
    await environment.goto(environment.getRootUrl());
    environment.page.on('pageerror', (err) => pageErrors.push(err.message));
    await environment.openUngit(testRepoPaths[0]);
    await environment.waitForElementVisible('.modern-repository');
    await environment.waitForElementHidden('.repository-actions');
    for (const c of ['modern-sidebar', 'modern-center', 'modern-right']) {
      await environment.waitForElementVisible(`[data-ta-container="${c}"]`);
    }
    await environment.waitForElementVisible('[data-ta-clickable="modern-fetch"]');
  });

  it('resizes the columns by dragging the gutter and persists the width', async () => {
    const gutter = await environment.page.$('[data-ta-clickable="modern-gutter-left"]');
    const box = await gutter.boundingBox();
    const { mouse } = environment.page;
    await mouse.move(box.x + 2, box.y + 50);
    await mouse.down();
    await mouse.move(2000, box.y + 50, { steps: 5 }); // far right: must clamp to 420
    await mouse.up();
    const stored = await environment.page.evaluate(() =>
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- runs in the browser
      window.localStorage.getItem('modernLeftWidth')
    );
    if (stored !== '420') throw new Error(`expected clamped width 420, got ${stored}`);
  });

  it('opens a bare repository', async () => {
    pageErrors.length = 0;
    await environment.openUngit(testRepoPaths[1]);
    await environment.waitForElementVisible('.modern-repository');
    if (await environment.page.$('[data-ta-clickable="wip-row"]')) {
      throw new Error('wip-row should not exist in a bare repository');
    }
    if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join('; ')}`);
  });
  const rowSel = (title) => `.modern-row[data-ta-node-title="${title}"]`;
  const selectedSha = () =>
    environment.page.$eval('.modern-repository', (el) => el.getAttribute('data-ta-selected-sha'));

  it('shows one row per commit plus no WIP row when clean', async () => {
    await environment.openUngit(testRepoPaths[2]);
    for (const n of [0, 1, 2]) await environment.waitForElementVisible(rowSel(`Init Commit ${n}`));
    const count = await environment.page.$$eval('.modern-row', (els) => els.length);
    if (count !== 3) throw new Error(`expected 3 rows, got ${count}`);
    if (await environment.page.$('[data-ta-clickable="wip-row"]')) {
      throw new Error('wip-row should not exist in a clean repository');
    }
    // default selection is HEAD (the newest commit)
    await environment.waitForElementVisible(`${rowSel('Init Commit 2')}.sel`);
  });

  it('shows a WIP row when the working tree is dirty', async () => {
    await environment.createTestFile(`${testRepoPaths[2]}/wipfile.txt`, testRepoPaths[2]);
    await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
    const count = await environment.page.$$eval('.modern-row', (els) => els.length);
    if (count !== 4) throw new Error(`expected 4 rows, got ${count}`);
    // creating a WIP row must not steal the selection from HEAD
    await environment.waitForElementVisible(`${rowSel('Init Commit 2')}.sel`);
  });

  it('selects a commit on click', async () => {
    await environment.click(rowSel('Init Commit 1'));
    await environment.waitForElementVisible(`${rowSel('Init Commit 1')}.sel`);
    const sha = await environment.page.$eval(`${rowSel('Init Commit 1')}`, (el) =>
      el.getAttribute('data-ta-sha')
    );
    if (!sha || (await selectedSha()) !== sha) throw new Error('selection attribute mismatch');
    await environment.click('[data-ta-clickable="wip-row"]');
    await environment.waitForElementVisible('[data-ta-clickable="wip-row"].sel');
    if ((await selectedSha()) !== 'WIP') throw new Error('WIP should be selected');
  });

  it('keeps selection after external refresh', async () => {
    await environment.click(rowSel('Init Commit 1'));
    await environment.waitForElementVisible(`${rowSel('Init Commit 1')}.sel`);
    await environment.createTestFile(`${testRepoPaths[2]}/external.txt`, testRepoPaths[2]);
    await environment.backgroundAction('POST', '/api/commit', {
      path: testRepoPaths[2],
      message: 'External Commit',
      files: [{ name: 'external.txt' }],
    });
    await environment.ensureRedraw();
    await environment.waitForElementVisible(rowSel('External Commit'));
    await environment.waitForElementVisible(`${rowSel('Init Commit 1')}.sel`);
  });

  it('keeps the DOM row count small in a long history', async () => {
    await environment.openUngit(testRepoPaths[3]);
    await environment.waitForElementVisible('.modern-row');
    const nodes = () =>
      environment.page.evaluate(() => ungit.__app.content().repository().graph.nodes().length);
    for (let i = 0; i < 20 && (await nodes()) < 150; i++) {
      await environment.page.$eval('.modern-rows', (el) => (el.scrollTop = el.scrollHeight));
      await environment.wait(700);
    }
    const loaded = await nodes();
    if (loaded < 150) throw new Error(`expected 150 loaded nodes, got ${loaded}`);
    await environment.page.$eval('.modern-rows', (el) => (el.scrollTop = el.scrollHeight));
    await environment.wait(300);
    const domRows = await environment.page.$$eval('.modern-row', (els) => els.length);
    if (domRows >= 80) throw new Error(`expected < 80 DOM rows, got ${domRows}`);
    await environment.waitForElementVisible(rowSel('Init Commit 0'));
    await environment.page.$eval('.modern-rows', (el) => (el.scrollTop = 0));
    await environment.waitForElementVisible(rowSel('Init Commit 149'));
  });

  describe('right panel', () => {
    const rowSel = (title) => `.modern-row[data-ta-node-title="${title}"]`;
    const rightSel = '[data-ta-container="modern-right"]';
    const titleInput = '[data-ta-input="modern-commit-title"]';
    const commitBtn = '[data-ta-clickable="modern-commit"]';

    it('shows commit details and navigates to the parent', async () => {
      await environment.openUngit(testRepoPaths[5]);
      await environment.waitForElementVisible(rowSel('Init Commit 2'));
      await environment.click(rowSel('Init Commit 2'));
      await environment.waitForElementVisible(`${rightSel} [data-ta-clickable="copy-sha"]`);
      await environment.waitForElementVisible(`${rightSel} .modern-file[data-ta-file="testy2"]`);
      await environment.waitForElementVisible(`${rightSel} [data-ta-clickable="modern-parent"]`);
      await environment.click(`${rightSel} [data-ta-clickable="modern-parent"]`);
      await environment.waitForElementVisible(`${rowSel('Init Commit 1')}.sel`);
      await environment.waitForElementVisible(`${rightSel} .modern-file[data-ta-file="testy1"]`);
    });

    it('commits from the WIP panel', async () => {
      await environment.createTestFile(`${testRepoPaths[5]}/wipcommit.txt`, testRepoPaths[5]);
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
      await environment.click('[data-ta-clickable="wip-row"]');
      await environment.waitForElementVisible(
        `${rightSel} .modern-file[data-ta-file="wipcommit.txt"]`
      );
      const fileSel = (sec) =>
        `${rightSel} [data-ta-container="modern-${sec}"] .modern-file[data-ta-file="wipcommit.txt"]`;
      await environment.waitForElementVisible(fileSel('staged'));
      await environment.click(`${fileSel('staged')} input[type=checkbox]`);
      await environment.waitForElementVisible(fileSel('unstaged'));
      await environment.waitForElementVisible(`${commitBtn}[disabled]`);
      await environment.click(`${fileSel('unstaged')} input[type=checkbox]`);
      await environment.waitForElementVisible(fileSel('staged'));
      await environment.insert(titleInput, 'Modern WIP commit');
      await environment.waitForElementVisible(`${commitBtn}:not([disabled])`);
      await environment.click(commitBtn);
      await environment.waitForElementHidden('[data-ta-clickable="wip-row"]');
      await environment.waitForElementVisible(rowSel('Modern WIP commit'));
      const first = await environment.page.$eval('.modern-row', (el) =>
        el.getAttribute('data-ta-node-title')
      );
      if (first !== 'Modern WIP commit') throw new Error(`top row is "${first}"`);
    });

    it('commits in an empty repository', async () => {
      await environment.openUngit(testRepoPaths[4]);
      await environment.createTestFile(`${testRepoPaths[4]}/first.txt`, testRepoPaths[4]);
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
      await environment.click('[data-ta-clickable="wip-row"]');
      await environment.insert(titleInput, 'First commit');
      await environment.waitForElementVisible(`${commitBtn}:not([disabled])`);
      await environment.click(commitBtn);
      await environment.waitForElementVisible(rowSel('First commit'));
    });

    it('shows conflict banner during a merge conflict', async () => {
      const dir = testRepoPaths[6];
      const file = `${dir}/testy0`;
      await environment.backgroundAction('POST', '/api/branches', { path: dir, name: 'other' });
      await environment.backgroundAction('POST', '/api/testing/changefile', {
        path: dir,
        file,
        content: 'master side\n',
      });
      await environment.backgroundAction('POST', '/api/commit', {
        path: dir,
        message: 'Master edit',
        files: [{ name: 'testy0' }],
      });
      await environment.backgroundAction('POST', '/api/checkout', { path: dir, name: 'other' });
      await environment.backgroundAction('POST', '/api/testing/changefile', {
        path: dir,
        file,
        content: 'other side\n',
      });
      await environment.backgroundAction('POST', '/api/commit', {
        path: dir,
        message: 'Other edit',
        files: [{ name: 'testy0' }],
      });
      await environment.openUngit(dir);
      try {
        await environment.backgroundAction('POST', '/api/merge', { path: dir, with: 'master' });
      } catch {
        // expected: merge-failed
      }
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
      await environment.click('[data-ta-clickable="wip-row"]');
      await environment.waitForElementVisible(`${rightSel} [data-ta-container="conflict-banner"]`);
      await environment.waitForElementHidden(commitBtn);
      await environment.click('[data-ta-clickable="modern-conflict-abort"]');
      await environment.waitForElementHidden('[data-ta-container="conflict-banner"]');
    });

    it('resolves a merge conflict and continues', async () => {
      const dir = testRepoPaths[6];
      try {
        await environment.backgroundAction('POST', '/api/merge', { path: dir, with: 'master' });
      } catch {
        // expected: merge-failed
      }
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
      await environment.click('[data-ta-clickable="wip-row"]');
      await environment.waitForElementVisible(`${rightSel} [data-ta-container="conflict-banner"]`);
      await environment.waitForElementVisible(
        '[data-ta-clickable="modern-conflict-continue"][disabled]'
      );
      await environment.backgroundAction('POST', '/api/testing/changefile', {
        path: dir,
        file: `${dir}/testy0`,
        content: 'resolved\n',
      });
      execFileSync('git', ['add', 'testy0'], { cwd: dir });
      await environment.waitForElementVisible(
        '[data-ta-clickable="modern-conflict-continue"]:not([disabled])'
      );
      await environment.waitForElementHidden(commitBtn);
      await environment.click('[data-ta-clickable="modern-conflict-continue"]');
      await environment.waitForElementHidden('[data-ta-container="conflict-banner"]');
      await environment.waitForElementVisible(rowSel("Merge branch 'master' into other"));
    });
  });

  describe('diff view', () => {
    const dir = () => testRepoPaths[7];
    const file = () => `${dir()}/diffy.txt`;
    const lines = (changed) =>
      Array.from({ length: 20 }, (_, i) => (i === 9 && changed ? 'changed line' : `line ${i + 1}`))
        .join('\n')
        .concat('\n');
    const diffSel = '[data-ta-container="modern-diff"]';
    const listSel = '[data-ta-container="modern-commit-list"]';
    const fileSel = '[data-ta-container="modern-right"] .modern-file[data-ta-file="diffy.txt"]';
    const codeLines = () => environment.page.$$eval('.d2h-code-line', (els) => els.length);
    const storedMode = () =>
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- runs in the browser
      environment.page.evaluate(() => window.localStorage.getItem('modernDiffMode'));

    it('opens a file diff over the commit list in hunk mode', async () => {
      const commit = async (content, message) => {
        await environment.backgroundAction('POST', '/api/testing/changefile', {
          path: dir(),
          file: file(),
          content,
        });
        await environment.backgroundAction('POST', '/api/commit', {
          path: dir(),
          message,
          files: [{ name: 'diffy.txt' }],
        });
      };
      await commit(lines(false), 'Add diffy');
      await commit(lines(true), 'Change diffy');
      await environment.openUngit(dir());
      await environment.waitForElementVisible(rowSel('Change diffy'));
      await environment.click(rowSel('Change diffy'));
      await environment.waitForElementVisible(fileSel);
      await environment.click(fileSel);
      await environment.waitForElementVisible(diffSel);
      await environment.waitForElementHidden(listSel);
      await environment.waitForElementVisible('.d2h-code-line');
      const n = await codeLines();
      if (n >= 20) throw new Error(`hunk mode should show < 20 code lines, got ${n}`);
    });

    it('switches to inline and split and persists the mode', async () => {
      await environment.click('[data-ta-clickable="diff-mode-inline"]');
      await environment.page.waitForFunction(
        () => document.querySelectorAll('.d2h-code-line').length >= 20,
        { timeout: 10000 }
      );
      await environment.click('[data-ta-clickable="diff-mode-split"]');
      await environment.waitForElementVisible('.d2h-file-side-diff');
      const stored = await storedMode();
      if (!/split/.test(stored)) throw new Error(`mode not persisted: ${stored}`);
      await environment.page.reload();
      await environment.waitForElementVisible('.modern-repository');
      await environment.waitForElementVisible(rowSel('Change diffy'));
      await environment.click(rowSel('Change diffy'));
      await environment.click(fileSel);
      await environment.waitForElementVisible('.d2h-file-side-diff');
      await environment.waitForElementVisible('[data-ta-clickable="diff-mode-split"].on');
    });

    it('closes with Escape and the close button', async () => {
      await environment.page.keyboard.press('Escape');
      await environment.waitForElementHidden(diffSel);
      await environment.waitForElementVisible(listSel);
      await environment.click(fileSel);
      await environment.waitForElementVisible(diffSel);
      await environment.click('[data-ta-clickable="diff-close"]');
      await environment.waitForElementHidden(diffSel);
      await environment.waitForElementVisible(listSel);
    });
  });
});

'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
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
      { bare: false, initCommits: 2 }, // 8: sidebar
      { bare: false, initCommits: 3 }, // 9: context menus and drag & drop
      { bare: false, initCommits: 3 }, // 10: squash
      { bare: false, initCommits: 60 }, // 11: history loading
      { bare: false, initCommits: 2 }, // 12: pull (upstream, cloned below)
      { bare: false, initCommits: 3 }, // 13: rewritten selection
      { bare: false, initCommits: 2 }, // 14: drag merge direction
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
    // nothing to stash in a clean working tree
    await environment.waitForElementVisible('[data-ta-clickable="modern-stash"][disabled]');
    // default selection is HEAD (the newest commit)
    await environment.waitForElementVisible(`${rowSel('Init Commit 2')}.sel`);
  });

  it('shows a WIP row when the working tree is dirty', async () => {
    await environment.createTestFile(`${testRepoPaths[2]}/wipfile.txt`, testRepoPaths[2]);
    await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
    const count = await environment.page.$$eval('.modern-row', (els) => els.length);
    if (count !== 4) throw new Error(`expected 4 rows, got ${count}`);
    await environment.waitForElementVisible('[data-ta-clickable="modern-stash"]:not([disabled])');
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
      const before = await nodes();
      await environment.page.$eval('.modern-rows', (el) => (el.scrollTop = el.scrollHeight));
      await environment.page.waitForFunction(
        (n) => ungit.__app.content().repository().graph.nodes().length > n,
        {},
        before
      );
    }
    const loaded = await nodes();
    if (loaded < 150) throw new Error(`expected 150 loaded nodes, got ${loaded}`);
    await environment.page.$eval('.modern-rows', (el) => (el.scrollTop = el.scrollHeight));
    await environment.waitForElementVisible(rowSel('Init Commit 0'));
    const domRows = await environment.page.$$eval('.modern-row', (els) => els.length);
    if (domRows >= 80) throw new Error(`expected < 80 DOM rows, got ${domRows}`);
    await environment.page.$eval('.modern-rows', (el) => (el.scrollTop = 0));
    await environment.waitForElementVisible(rowSel('Init Commit 149'));
  });

  describe('history loading', () => {
    const repo = () => testRepoPaths[11];
    const graphValue = (fn) =>
      environment.page.evaluate(
        (body) => new Function('g', body)(ungit.__app.content().repository().graph),
        fn
      );
    const notLoaded = '[data-ta-container="commit-not-loaded"]';
    let sha0;

    it('fills the viewport with commits without scrolling', async () => {
      await environment.openUngit(repo());
      await environment.waitForElementVisible('.modern-row');
      await environment.page.waitForFunction(() => {
        const el = document.querySelector('.modern-rows');
        return el && el.scrollTop === 0 && el.scrollHeight > el.clientHeight + 28;
      });
    });

    it('keeps a not loaded commit selected and loads it on demand', async () => {
      sha0 = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo() })
        .toString()
        .trim();
      const isInited = `const n = g.nodesById['${sha0}']; return !!(n && n.isInited);`;
      if (await graphValue(isInited)) throw new Error('the oldest commit should not be loaded');
      await environment.backgroundAction('POST', '/api/branches', {
        path: repo(),
        name: 'old',
        sha1: sha0,
      });
      await environment.ensureRedraw();
      await environment.click('.modern-sidebar-item[data-ta-name="old"]');
      await environment.waitForElementVisible(notLoaded);
      if ((await selectedSha()) !== sha0) throw new Error('the branch commit should be selected');
      // a graph reload must not move the selection away
      await environment.ensureRedraw();
      await environment.waitForElementVisible(notLoaded);
      if ((await selectedSha()) !== sha0) throw new Error('selection lost on reload');
      await environment.click('[data-ta-clickable="load-more-commits"]');
      await environment.waitForElementHidden(notLoaded);
      await environment.waitForElementVisible('[data-ta-container="commit-details"]');
      const title = await environment.page.$eval(
        '[data-ta-container="commit-title"]',
        (el) => el.textContent
      );
      if (title !== 'Init Commit 0') throw new Error(`unexpected title ${title}`);
      if ((await selectedSha()) !== sha0) throw new Error('selection lost after loading');
    });

    it('reloads when a shorter, out of order page of history was applied last', async () => {
      const total = await graphValue('return g.nodes().length;');
      if (total !== 60) throw new Error(`expected 60 loaded nodes, got ${total}`);
      // what an older /gitlog answer arriving after the newer one does
      await graphValue('g._apiCache = undefined; g.nodes(g.nodes().slice(0, 25));');
      await environment.page.waitForFunction(
        () => ungit.__app.content().repository().graph.nodes().length === 60
      );
    });

    it('stops loading at the end of history', async () => {
      const limit = await graphValue('return g.limit();');
      await environment.page.$eval('.modern-rows', (el) => (el.scrollTop = el.scrollHeight));
      await environment.waitForElementVisible(rowSel('Init Commit 0'));
      await environment.wait(1500); // nothing must happen: give a load the time to start
      const after = await graphValue('return g.limit();');
      if (after !== limit) throw new Error(`limit raised from ${limit} to ${after} at the end`);
    });
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

    it('copies the SHA without the clipboard API (insecure origin)', async () => {
      pageErrors.length = 0;
      await environment.page.evaluate(() => {
        // eslint-disable-next-line n/no-unsupported-features/node-builtins -- runs in the browser
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        window.__copied = [];
        document.execCommand = (cmd) => {
          window.__copied.push(cmd);
          return true;
        };
      });
      await environment.click(`${rightSel} [data-ta-clickable="copy-sha"]`);
      await environment.page.waitForFunction(() => window.__copied.includes('copy'));
      const row = await environment.waitForElementVisible(rowSel('Init Commit 1'));
      await row.click({ button: 'right' });
      await environment.click('[data-ta-container="context-menu"] [data-ta-action="copy-sha"]');
      await environment.page.waitForFunction(() => window.__copied.length === 2);
      if (await environment.page.$('.crash')) throw new Error('copy crashed the app');
      if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join('; ')}`);
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

    it('shows no line counts for a binary file', async () => {
      const dir = testRepoPaths[5];
      fs.writeFileSync(`${dir}/bin.dat`, Buffer.from([0, 1, 2, 0, 255, 0, 3]));
      await environment.backgroundAction('POST', '/api/commit', {
        path: dir,
        message: 'Binary commit',
        files: [{ name: 'bin.dat' }],
      });
      await environment.waitForElementVisible(rowSel('Binary commit'));
      await environment.click(rowSel('Binary commit'));
      const fs1 = `${rightSel} .modern-file[data-ta-file="bin.dat"] .modern-fs`;
      await environment.waitForElementVisible(`${rightSel} .modern-file[data-ta-file="bin.dat"]`);
      const text = await environment.page.$eval(fs1, (el) => el.textContent.trim());
      if (text !== '') throw new Error(`binary file shows counts "${text}"`);
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

    it('toggling whitespace re-fetches only the current diff', async () => {
      await environment.click(fileSel);
      await environment.waitForElementVisible('.d2h-file-side-diff');
      for (const m of ['inline', 'hunk', 'split', 'inline', 'hunk']) {
        await environment.click(`[data-ta-clickable="diff-mode-${m}"]`);
        await environment.waitForElementVisible(`[data-ta-clickable="diff-mode-${m}"].on`);
        await environment.page.waitForNetworkIdle();
      }
      const urls = [];
      const onRequest = (req) => {
        if (/\/api\/diff\?/.test(req.url())) urls.push(req.url());
      };
      environment.page.on('request', onRequest);
      await environment.click('[data-ta-clickable="diff-whitespace"]');
      await environment.page.waitForNetworkIdle();
      await environment.wait(500);
      environment.page.off('request', onRequest);
      if (urls.length !== 1) throw new Error(`expected 1 /diff request, got ${urls.length}`);
      await environment.click('[data-ta-clickable="diff-close"]');
      await environment.waitForElementVisible(listSel);
    });

    it('closes the diff of a WIP file once it is committed', async () => {
      await environment.createTestFile(`${dir()}/wipdiff.txt`, dir());
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
      await environment.click('[data-ta-clickable="wip-row"]');
      const wipFile = '[data-ta-container="modern-right"] .modern-file[data-ta-file="wipdiff.txt"]';
      await environment.click(wipFile);
      await environment.waitForElementVisible(diffSel);
      await environment.backgroundAction('POST', '/api/commit', {
        path: dir(),
        message: 'Commit wipdiff',
        files: [{ name: 'wipdiff.txt' }],
      });
      await environment.waitForElementHidden('[data-ta-clickable="wip-row"]');
      await environment.waitForElementHidden(diffSel);
      await environment.waitForElementVisible(listSel);
    });
  });

  describe('sidebar', () => {
    const sb = '[data-ta-container="modern-sidebar"]';
    const item = (name) => `${sb} .modern-sidebar-item[data-ta-name="${name}"]`;
    const section = (id) => `${sb} [data-ta-section="${id}"]`;
    const filterSel = '[data-ta-input="sidebar-filter"]';

    it('lists local branches and marks the checked out one', async () => {
      await environment.openUngit(testRepoPaths[8]);
      await environment.backgroundAction('POST', '/api/branches', {
        path: testRepoPaths[8],
        name: 'feature',
        sha1: 'HEAD',
      });
      await environment.ensureRedraw();
      await environment.waitForElementVisible(`${item('master')}.current`);
      await environment.waitForElementVisible(item('feature'));
    });

    it('checks out a branch on double click', async () => {
      await environment.click(item('feature'), 2);
      await environment.waitForElementVisible(`${item('feature')}.current`);
      await environment.waitForElementVisible('.modern-ref.current[data-ta-name="feature"]');
      await environment.waitForElementHidden(`${item('master')}.current`);
    });

    it('filters items case-insensitively', async () => {
      await environment.insert(filterSel, 'FEAT');
      await environment.waitForElementHidden(item('master'));
      await environment.waitForElementVisible(item('feature'));
      await environment.page.$eval(filterSel, (el) => {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await environment.waitForElementVisible(item('master'));
    });

    it('collapses a section and persists it', async () => {
      await environment.click(`${section('local')} [data-ta-clickable="sidebar-section-local"]`);
      await environment.waitForElementHidden(item('master'));
      const stored = await environment.page.evaluate(() =>
        // eslint-disable-next-line n/no-unsupported-features/node-builtins -- runs in the browser
        window.localStorage.getItem('modernSidebarClosed')
      );
      if (!/local/.test(stored)) throw new Error(`not persisted: ${stored}`);
      await environment.click(`${section('local')} [data-ta-clickable="sidebar-section-local"]`);
      await environment.waitForElementVisible(item('master'));
    });

    it('shows a stash, opens it in the right panel and applies it', async () => {
      await environment.createTestFile(`${testRepoPaths[8]}/testy1`, testRepoPaths[8]);
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
      await environment.click('[data-ta-clickable="modern-stash"]');
      await environment.waitForElementHidden('[data-ta-clickable="wip-row"]');
      const stashItem = `${section('stashes')} .modern-sidebar-item`;
      await environment.waitForElementVisible(stashItem);
      const n = await environment.page.$$eval(stashItem, (els) => els.length);
      if (n !== 1) throw new Error(`expected 1 stash, got ${n}`);
      // the filter matches the stash label (message), not only its reflog id
      const label = await environment.page.$eval(`${stashItem} .modern-sb-nm`, (el) =>
        el.textContent.trim()
      );
      const word = label.split(/\s+/).pop();
      await environment.insert(filterSel, word.toUpperCase());
      await environment.waitForElementVisible(stashItem);
      await environment.page.$eval(filterSel, (el) => {
        el.value = 'no-such-stash';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await environment.waitForElementHidden(stashItem);
      await environment.page.$eval(filterSel, (el) => {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await environment.waitForElementVisible(stashItem);
      await environment.click(stashItem);
      await environment.waitForElementVisible('[data-ta-container="stash-details"]');
      await environment.waitForElementVisible('[data-ta-container="stash-files"] [data-ta-file]');
      await environment.click('[data-ta-clickable="stash-apply"]');
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
    });

    it('falls back to HEAD when the selected stash is dropped', async () => {
      await environment.click('[data-ta-clickable="stash-drop"]');
      await environment.click('.modal-dialog .btn-primary');
      await environment.waitForElementHidden(`${section('stashes')} .modern-sidebar-item`);
      await environment.waitForElementVisible('[data-ta-container="commit-details"]');
      const head = await environment.page.evaluate(
        () => ungit.__app.content().repository().graph.HEAD().sha1
      );
      if ((await selectedSha()) !== head) throw new Error('selection should fall back to HEAD');
    });

    it('selects the commit of a clicked branch', async () => {
      await environment.click(item('master'));
      const master = await environment.page.evaluate(
        () => ungit.__app.content().repository().graph.getRef('refs/heads/master').node().sha1
      );
      await environment.page.waitForFunction(
        (sha) =>
          document.querySelector('.modern-repository').getAttribute('data-ta-selected-sha') === sha,
        {},
        master
      );
    });

    it('double click on a remote branch checks out its local branch without moving it', async () => {
      const dir = testRepoPaths[8];
      const rev = (r) => execFileSync('git', ['rev-parse', r], { cwd: dir }).toString().trim();
      await environment.backgroundAction('POST', '/api/checkout', { path: dir, name: 'master' });
      const feature = rev('feature');
      // origin/feature one commit behind the local branch, as after a local commit
      execFileSync('git', ['update-ref', 'refs/remotes/origin/feature', `${feature}~1`], {
        cwd: dir,
      });
      await environment.ensureRedraw();
      await environment.waitForElementVisible(`${item('master')}.current`);
      await environment.click(item('origin/feature'), 2);
      await environment.waitForElementVisible(`${item('feature')}.current`);
      if (rev('feature') !== feature) throw new Error('the local branch was moved');
    });
  });

  describe('context menus and drag & drop', () => {
    const ctx = '[data-ta-container="context-menu"]';
    const action = (id) => `${ctx} [data-ta-action="${id}"]`;
    const pill = (name) => `.modern-ref[data-ta-name="${name}"]`;
    const rightClick = async (selector) => {
      const el = await environment.waitForElementVisible(selector);
      await el.click({ button: 'right' });
      await environment.waitForElementVisible(ctx);
    };

    // Drags with the real mouse (puppeteer 25 dispatches native HTML5 drag events itself).
    const dragTo = async (fromSelector, toSelector) => {
      const from = await (await environment.waitForElementVisible(fromSelector)).boundingBox();
      const to = await (await environment.waitForElementVisible(toSelector)).boundingBox();
      const { mouse } = environment.page;
      await mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await mouse.down();
      await mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
      await mouse.move(to.x + 300, to.y + to.height / 2, { steps: 10 });
      await mouse.up();
    };

    it('resets softly to a commit from the commit menu', async () => {
      await environment.openUngit(testRepoPaths[9]);
      for (const n of [0, 1, 2])
        await environment.waitForElementVisible(rowSel(`Init Commit ${n}`));
      await rightClick(rowSel('Init Commit 1'));
      await environment.page.hover(action('reset'));
      await environment.click(action('reset-soft'));
      await environment.waitForElementHidden(ctx);
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
      await environment.page.waitForFunction(
        () => ungit.__app.content().repository().graph.HEAD().title() === 'Init Commit 1'
      );
      await environment.click('[data-ta-clickable="wip-row"]');
      await environment.waitForElementVisible('[data-ta-file]');
    });

    it('closes the menu on Escape and on outside click', async () => {
      await rightClick(rowSel('Init Commit 0'));
      await environment.press('Escape');
      await environment.waitForElementHidden(ctx);
      await rightClick(rowSel('Init Commit 0'));
      await environment.page.mouse.click(5, 5);
      await environment.waitForElementHidden(ctx);
    });

    it('keeps a sub-menu inside the window', async () => {
      await environment.page.evaluate(() => {
        const repo = ungit.__app.content().repository();
        repo.actions.openCommitMenu(200, window.innerHeight - 5, repo.graph.HEAD());
      });
      await environment.waitForElementVisible(ctx);
      await environment.page.hover(action('reset'));
      await environment.waitForElementVisible(action('reset-hard'));
      const { bottom, top, vh } = await environment.page.$eval(
        `${ctx} [data-ta-action="reset"] > .modern-ctx-subm`,
        (el) => {
          const r = el.getBoundingClientRect();
          return { bottom: r.bottom, top: r.top, vh: window.innerHeight };
        }
      );
      if (bottom > vh || top < 0) throw new Error(`sub-menu off screen: ${top}-${bottom} / ${vh}`);
      await environment.press('Escape');
      await environment.waitForElementHidden(ctx);
    });

    it('creates a branch on a commit from the commit menu', async () => {
      await rightClick(rowSel('Init Commit 0'));
      await environment.click(action('create-branch'));
      await environment.insert('.modal-dialog input.form-control', 'from-menu');
      await environment.click('.modal-dialog .btn-primary');
      await environment.waitForElementVisible(`${rowSel('Init Commit 0')} ${pill('from-menu')}`);
    });

    it('moves a branch by dragging its pill onto a commit row', async () => {
      const sha0 = await environment.page.$eval(rowSel('Init Commit 0'), (e) =>
        e.getAttribute('data-ta-sha')
      );
      await environment.backgroundAction('POST', '/api/branches', {
        path: testRepoPaths[9],
        name: 'feature',
        sha1: sha0,
      });
      await environment.ensureRedraw();
      await environment.waitForElementVisible(`${rowSel('Init Commit 0')} ${pill('feature')}`);
      await dragTo(pill('feature'), rowSel('Init Commit 1'));
      await environment.waitForElementVisible(`${ctx} [data-ta-action="move-ref"]`);
      await environment.click(action('move-ref'));
      await environment.waitForElementVisible(`${rowSel('Init Commit 1')} ${pill('feature')}`);
      await environment.waitForElementHidden(`${rowSel('Init Commit 0')} ${pill('feature')}`);
    });

    it('deletes a branch from the sidebar menu', async () => {
      const item = '.modern-sidebar-item[data-ta-name="feature"]';
      await rightClick(item);
      await environment.click(action('delete-ref'));
      await environment.click('.modal-dialog .btn-primary');
      await environment.waitForElementHidden(item);
      await environment.waitForElementHidden(pill('feature'));
    });

    it('merges the dragged branch INTO the branch it is dropped on', async () => {
      const repo = testRepoPaths[14];
      await environment.openUngit(repo);
      await environment.waitForElementVisible(rowSel('Init Commit 1'));
      const sha1 = await environment.page.$eval(rowSel('Init Commit 1'), (e) =>
        e.getAttribute('data-ta-sha')
      );
      await environment.backgroundAction('POST', '/api/branches', {
        path: repo,
        name: 'test2',
        sha1,
      });
      await environment.backgroundAction('POST', '/api/checkout', { path: repo, name: 'test2' });
      await environment.createTestFile(`${repo}/on-test2.txt`, repo);
      await environment.backgroundAction('POST', '/api/commit', {
        path: repo,
        message: 'On test2',
        files: [{ name: 'on-test2.txt' }],
      });
      await environment.backgroundAction('POST', '/api/checkout', { path: repo, name: 'master' });
      await environment.ensureRedraw();
      await environment.waitForElementVisible(`${rowSel('On test2')} ${pill('test2')}`);
      await dragTo(pill('test2'), rowSel('Init Commit 1'));
      await environment.waitForElementVisible(action('merge-into-target'));
      const label = await environment.page.$eval(action('merge-into-target'), (e) =>
        e.textContent.trim()
      );
      if (!/Merge test2 into master/.test(label)) throw new Error(`unexpected label: ${label}`);
      await environment.click(action('merge-into-target'));
      await environment.page.waitForFunction(
        () => {
          const g = ungit.__app.content().repository().graph;
          return g.checkedOutBranch() === 'master' && g.HEAD() && g.HEAD().parents().length === 2;
        },
        { timeout: 10000 }
      );
    });

    it('squashes HEAD with its previous commit', async () => {
      await environment.openUngit(testRepoPaths[10]);
      await environment.waitForElementVisible(rowSel('Init Commit 2'));
      await rightClick(rowSel('Init Commit 2'));
      await environment.click(action('squash'));
      await environment.waitForElementVisible('[data-ta-clickable="wip-row"]');
      await environment.page.waitForFunction(
        () => ungit.__app.content().repository().graph.HEAD().title() === 'Init Commit 0'
      );
      await environment.click('[data-ta-clickable="wip-row"]');
      await environment.waitForElementVisible('[data-ta-file="testy1"]');
      await environment.waitForElementVisible('[data-ta-file="testy2"]');
    });

    it('moves the selection off a rewritten commit (uncommit of HEAD)', async () => {
      await environment.openUngit(testRepoPaths[13]);
      await environment.waitForElementVisible(`${rowSel('Init Commit 2')}.sel`);
      await rightClick(rowSel('Init Commit 2'));
      await environment.click(action('uncommit'));
      await environment.waitForElementHidden(rowSel('Init Commit 2'));
      await environment.waitForElementVisible(`${rowSel('Init Commit 1')}.sel`);
      const head = await environment.page.evaluate(
        () => ungit.__app.content().repository().graph.HEAD().sha1
      );
      if ((await selectedSha()) !== head) throw new Error('selection should move to the new HEAD');
      await environment.page.waitForFunction(
        () =>
          document.querySelector('[data-ta-container="commit-title"]').textContent ===
          'Init Commit 1'
      );
    });
  });

  describe('pull', () => {
    const upstream = () => testRepoPaths[12];
    const clone = () => `${testRepoPaths[12]}-clone`;
    const pullBtn = '[data-ta-clickable="modern-pull"]:not([disabled])';
    const modal = '[data-ta-container="yes-no-modal"]';
    const commitIn = async (dir, name, message) => {
      await environment.createTestFile(`${dir}/${name}`, dir);
      await environment.backgroundAction('POST', '/api/commit', {
        path: dir,
        message,
        files: [{ name }],
      });
    };
    const headTitle = (title) =>
      environment.page.waitForFunction(
        (t) => {
          const head = ungit.__app.content().repository().graph.HEAD();
          return head && head.title() === t;
        },
        {},
        title
      );
    const rebaseRequests = [];
    const onRequest = (req) => {
      if (/\/api\/rebase/.test(req.url())) rebaseRequests.push(req.url());
    };

    before(async () => {
      execFileSync('git', ['clone', '-q', upstream(), clone()]);
      await commitIn(upstream(), 'up1', 'Upstream change');
      await commitIn(clone(), 'local1', 'Local change');
      environment.page.on('request', onRequest);
    });

    after(() => environment.page.off('request', onRequest));

    it('asks before rebasing diverged branches, and does nothing on No', async () => {
      await environment.openUngit(clone());
      await environment.waitForElementVisible(rowSel('Local change'));
      await environment.click(pullBtn);
      await environment.waitForElementVisible(modal);
      const text = await environment.page.$eval(`${modal} .modal-body`, (el) => el.textContent);
      if (!text.includes('Rebase 1 local commit of master onto origin/master?'))
        throw new Error(`unexpected confirmation: ${text}`);
      await environment.click(`${modal} [data-ta-action="no"]`);
      await environment.waitForElementHidden(modal);
      await environment.page.waitForNetworkIdle();
      if (rebaseRequests.length) throw new Error('rebased although the answer was No');
    });

    it('rebases diverged branches on Yes', async () => {
      await environment.click(pullBtn);
      await environment.waitForElementVisible(modal);
      await environment.click(`${modal} [data-ta-action="yes"]`);
      await environment.page.waitForFunction(() => {
        const g = ungit.__app.content().repository().graph;
        const head = g.HEAD();
        const parent = head && g.nodesById[head.parents()[0]];
        return head.title() === 'Local change' && parent && parent.title() === 'Upstream change';
      });
    });

    it('does nothing when the local branch is only ahead', async () => {
      rebaseRequests.length = 0;
      await environment.click(pullBtn);
      await environment.page.waitForNetworkIdle();
      if (await environment.page.$(modal)) throw new Error('no confirmation expected');
      if (rebaseRequests.length) throw new Error('nothing to pull, no rebase expected');
    });

    it('fast-forwards without asking', async () => {
      execFileSync('git', ['reset', '-q', '--hard', 'origin/master'], { cwd: clone() });
      await commitIn(upstream(), 'up2', 'Upstream 2');
      await headTitle('Upstream change');
      await environment.click(pullBtn);
      await headTitle('Upstream 2');
      if (await environment.page.$(modal)) throw new Error('no confirmation expected');
    });
  });
});

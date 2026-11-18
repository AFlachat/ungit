'use strict';
const environment = require('./environment')({ serverStartupOptions: ['--ui=modern'] });
const testRepoPaths = [];

describe('[MODERN] shell', () => {
  const pageErrors = [];

  before('Environment init', async () => {
    await environment.init();
    await environment.createRepos(testRepoPaths, [{ bare: false }, { bare: true }]);
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
});

const expect = require('expect.js');
const request = require('supertest');
const express = require('express');
const path = require('path');
const restGit = require('../source/git-api');
const common = require('./common-es6.js');

const app = express();
app.use(require('body-parser').json());

restGit.registerApi({ app: app, config: { dev: true } });

const req = request(app);

describe('git-api reset modes', () => {
  let testDir, firstSha1;
  const files = ['one.txt', 'two.txt', 'three.txt'];

  const setup = async () => {
    testDir = await common.initRepo(req);
    for (const f of files) {
      await common.post(req, '/testing/createfile', { file: path.join(testDir, f) });
      await common.post(req, '/commit', {
        path: testDir,
        message: `add ${f}`,
        files: [{ name: f }],
      });
    }
    const log = await common.get(req, '/gitlog', { path: testDir });
    expect(log.nodes.length).to.be(3);
    firstSha1 = log.nodes[2].sha1;
    await common.post(req, '/testing/createfile', { file: path.join(testDir, 'staged.txt') });
    await common.post(req, '/testing/git', { path: testDir, command: ['add', 'staged.txt'] });
  };

  beforeEach(setup);

  afterEach(() => common.post(req, '/testing/cleanup', undefined));

  const status = async () => (await common.get(req, '/status', { path: testDir })).files;

  it('soft reset keeps later commits files staged', async () => {
    await common.post(req, '/reset', { path: testDir, mode: 'soft', to: firstSha1 });
    const st = await status();
    for (const f of ['two.txt', 'three.txt', 'staged.txt']) {
      expect(st[f]).to.be.ok();
      expect(st[f].staged).to.be(true);
    }
    const log = await common.get(req, '/gitlog', { path: testDir });
    expect(log.nodes[0].sha1).to.be(firstSha1);
  });

  it('mixed reset leaves later commits files unstaged', async () => {
    await common.post(req, '/reset', { path: testDir, mode: 'mixed', to: firstSha1 });
    const st = await status();
    for (const f of ['two.txt', 'three.txt', 'staged.txt']) {
      expect(st[f]).to.be.ok();
      expect(st[f].staged).to.be(false);
    }
    const log = await common.get(req, '/gitlog', { path: testDir });
    expect(log.nodes[0].sha1).to.be(firstSha1);
  });

  it('hard reset leaves a clean working tree', async () => {
    await common.post(req, '/reset', { path: testDir, mode: 'hard', to: firstSha1 });
    const st = await status();
    expect(Object.keys(st).length).to.be(0);
    const log = await common.get(req, '/gitlog', { path: testDir });
    expect(log.nodes.length).to.be(1);
    expect(log.nodes[0].sha1).to.be(firstSha1);
  });
});

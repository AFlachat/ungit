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

describe('git-api diff', () => {
  let testDir, testBareDir;

  before(() => {
    return common
      .initRepo(req)
      .then((dir) => (testDir = dir))
      .then(() => common.initRepo(req, { bare: true }))
      .then((dir) => (testBareDir = dir));
  });

  after(() => common.post(req, '/testing/cleanup', undefined));

  const testFile = 'afile.txt';
  const testFile2 = 'anotherfile.txt';
  const testImage = 'icon.png';

  it('diff on non existing file should fail', () => {
    return common.get(req, '/diff', { path: testDir, file: testFile });
  });

  let content;

  it('should be possible to create a file', () => {
    content = ['A', 'few', 'lines', 'of', 'content', ''];

    return common.post(req, '/testing/createfile', {
      file: path.join(testDir, testFile),
      content: content.join('\n'),
    });
  });

  it('should be possible to create an image file', () => {
    return common.post(req, '/testing/createimagefile', { file: path.join(testDir, testImage) });
  });

  it('diff on created file should work', () => {
    return common.get(req, '/diff', { path: testDir, file: testFile }).then((res) => {
      for (let i = 0; i < content.length; i++) {
        expect(res.indexOf(content[i])).to.be.above(-1);
      }
    });
  });

  it('diff on image file should work', () => {
    return common
      .getPng(req, '/diff/image', { path: testDir, filename: testImage, version: 'current' })
      .then((res) => expect(res.toString()).to.be('png'));
  });

  it('should be possible to commit a file', () => {
    return common.post(req, '/commit', {
      path: testDir,
      message: 'Init File',
      files: [{ name: testFile }],
    });
  });

  it('should be possible to commit an image file', () => {
    return common.post(req, '/commit', {
      path: testDir,
      message: 'Init Image',
      files: [{ name: testImage }],
    });
  });

  it('diff on first commit should work', () => {
    return common
      .get(req, '/gitlog', { path: testDir })
      .then((res) => {
        expect(res.nodes.length).to.be(2);
        return common.get(req, '/diff', { path: testDir, file: testFile, sha1: res.nodes[1].sha1 });
      })
      .then((res) => {
        for (let i = 0; i < content.length; i++) {
          expect(res.indexOf(content[i])).to.be.above(-1);
        }
      });
  });

  it('diff on commited file should work', () => {
    return common.get(req, '/diff', { path: testDir, file: testFile }).then((res) => {
      expect(res).to.be.an('array');
      expect(res.length).to.be(0);
    });
  });

  it('diff on commited image file should work', () => {
    return common
      .getPng(req, '/diff/image', { path: testDir, filename: testImage, version: 'current' })
      .then((res) => expect(res.toString()).to.be('png'));
  });

  it('should be possible to modify a file', () => {
    content.splice(2, 0, 'more');
    return common.post(req, '/testing/changefile', {
      file: path.join(testDir, testFile),
      content: content.join('\n'),
    });
  });

  it('should be possible to modify an image file', () => {
    return common.post(req, '/testing/changeimagefile', { file: path.join(testDir, testImage) });
  });

  it('diff on modified file should work', () => {
    return common.get(req, '/diff', { path: testDir, file: testFile }).then((res) => {
      expect(res.indexOf('diff --git a/afile.txt b/afile.txt')).to.be.above(-1);
      expect(res.indexOf('+more')).to.be.above(-1);
    });
  });

  it('diff on file commit should work if file is changing', () => {
    return common
      .get(req, '/gitlog', { path: testDir })
      .then((res) => {
        expect(res.nodes.length).to.be(2);
        return common.get(req, '/diff', { path: testDir, file: testFile, sha1: res.nodes[1].sha1 });
      })
      .then((res) => {
        expect(res.indexOf('diff --git a/afile.txt b/afile.txt')).to.be.above(-1);
        expect(res.indexOf('+more')).to.be(-1);
      });
  });

  it('getting current image file should work', () => {
    return common
      .getPng(req, '/diff/image', { path: testDir, filename: testImage, version: 'current' })
      .then((res) => expect(res.toString()).to.be('png ~~'));
  });

  it('getting previous image file should work', () => {
    return common
      .getPng(req, '/diff/image', { path: testDir, filename: testImage, version: 'HEAD' })
      .then((res) => expect(res.toString()).to.be('png'));
  });

  it('should be possible to rename a modified file', () => {
    return common.post(req, '/testing/git', {
      path: testDir,
      command: ['mv', testFile, testFile2],
    });
  });

  it('diff on renamed and modified file should work', () => {
    return common
      .get(req, '/diff', { path: testDir, file: testFile2, oldFile: testFile })
      .then((res) => {
        expect(res.indexOf('diff --git a/afile.txt b/anotherfile.txt')).to.be.above(-1);
        expect(res.indexOf('+more')).to.be.above(-1);
      });
  });

  it('should be possible to commit the renamed and modified file', () => {
    return common.post(req, '/commit', {
      path: testDir,
      message: 'Move and Change',
      files: [{ name: testFile2 }],
    });
  });

  it('diff on commit with renamed and modified file should work', () => {
    return common
      .get(req, '/gitlog', { path: testDir })
      .then((res) => {
        expect(res.nodes.length).to.be(3);
        return common.get(req, '/diff', {
          path: testDir,
          file: testFile2,
          oldFile: testFile,
          sha1: res.nodes[0].sha1,
        });
      })
      .then((res) => {
        for (let i = 0; i < content.length; i++) {
          expect(res.indexOf(content[i])).to.be.above(-1);
        }
      });
  });

  it('removing a test file should work', () => {
    return common.post(req, '/testing/removefile', { file: path.join(testDir, testFile2) });
  });

  it('should be possible to commit an image file for removal', () => {
    return common.post(req, '/commit', {
      path: testDir,
      message: 'Init',
      files: [{ name: testImage }],
    });
  });

  it('removing a test image file should work', () => {
    return common.post(req, '/testing/removefile', { file: path.join(testDir, testImage) });
  });

  it('diff on removed file should work', () => {
    return common.get(req, '/diff', { path: testDir, file: testFile2 }).then((res) => {
      expect(res.indexOf('deleted file')).to.be.above(-1);
      expect(res.indexOf('@@ -1,6 +0,0 @@')).to.be.above(-1);
    });
  });

  it('getting previous image file should work after removal', () => {
    return common
      .getPng(req, '/diff/image', { path: testDir, filename: testImage, version: 'HEAD' })
      .then((res) => expect(res.toString()).to.be('png ~~'));
  });

  it('diff on bare repository file should work', () => {
    // first add remote and push all commits
    return common
      .post(req, '/remotes/barerepository', { path: testDir, url: testBareDir })
      .then(() => common.post(req, '/push', { path: testDir, remote: 'barerepository' }))
      .then(() => common.get(req, '/gitlog', { path: testDir }))
      .then((res) => {
        // find a commit which contains the testFile
        const commit = res.nodes.filter((commit) =>
          commit.fileLineDiffs.some((lineDiff) => lineDiff.fileName == testFile)
        )[0];
        return common.get(req, '/diff', { path: testDir, sha1: commit.sha1, file: testFile });
      });
  });
});

describe('git-api diff context lines', () => {
  let testDir, commitSha1;
  const file = 'ctx.txt';
  const lines = [
    'line-a-x',
    'line-b-x',
    'line-c-x',
    'line-d-x',
    'line-e-x',
    'line-f-x',
    'line-g-x',
    'line-h-x',
    'line-i-x',
    'line-j-x',
    'line-k-x',
    'line-l-x',
    'line-m-x',
    'line-n-x',
    'line-o-x',
    'line-p-x',
    'line-q-x',
    'line-r-x',
    'line-s-x',
    'line-t-x',
  ];

  before(async () => {
    testDir = await common.initRepo(req);
    await common.post(req, '/testing/createfile', {
      file: path.join(testDir, file),
      content: lines.join('\n') + '\n',
    });
    await common.post(req, '/commit', { path: testDir, message: 'Init', files: [{ name: file }] });
    const changed = lines.slice();
    changed[9] = 'CHANGED10';
    await common.post(req, '/testing/changefile', {
      file: path.join(testDir, file),
      content: changed.join('\n') + '\n',
    });
    await common.post(req, '/commit', {
      path: testDir,
      message: 'Change',
      files: [{ name: file }],
    });
    const log = await common.get(req, '/gitlog', { path: testDir });
    commitSha1 = log.nodes[0].sha1;
    // working tree change for the non-commit diff
    changed[9] = 'CHANGED10 again';
    await common.post(req, '/testing/changefile', {
      file: path.join(testDir, file),
      content: changed.join('\n') + '\n',
    });
  });

  after(() => common.post(req, '/testing/cleanup', undefined));

  const hasAll = (res) => lines.every((l, i) => i == 9 || res.indexOf(l) > -1);

  it('diff with context=1000000 should include every line of the file', async () => {
    const res = await common.get(req, '/diff', { path: testDir, file, context: 1000000 });
    expect(hasAll(res)).to.be(true);
  });

  it('diff without context should only include 3 lines around the change', async () => {
    const res = await common.get(req, '/diff', { path: testDir, file });
    expect(res.indexOf('line-a-x')).to.be(-1);
    expect(res.indexOf('line-t-x')).to.be(-1);
    expect(res.indexOf('line-g-x')).to.be.above(-1);
  });

  it('diff with invalid context is ignored', async () => {
    const plain = await common.get(req, '/diff', { path: testDir, file });
    const res = await common.get(req, '/diff', { path: testDir, file, context: 'abc' });
    expect(res).to.be(plain);
  });

  it('commit diff with context=1000000 should include every line of the file', async () => {
    const res = await common.get(req, '/diff', {
      path: testDir,
      file,
      sha1: commitSha1,
      context: 1000000,
    });
    expect(hasAll(res)).to.be(true);
  });

  it('commit diff without context should only include 3 lines around the change', async () => {
    const res = await common.get(req, '/diff', { path: testDir, file, sha1: commitSha1 });
    expect(res.indexOf('line-a-x')).to.be(-1);
    expect(res.indexOf('line-t-x')).to.be(-1);
  });

  it('commit diff with invalid context is ignored', async () => {
    const plain = await common.get(req, '/diff', { path: testDir, file, sha1: commitSha1 });
    const res = await common.get(req, '/diff', {
      path: testDir,
      file,
      sha1: commitSha1,
      context: 'abc',
    });
    expect(res).to.be(plain);
  });
});

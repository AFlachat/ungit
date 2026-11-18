const components = require('ungit-components');
const programEvents = require('ungit-program-events');

// Opens the .gitignore editor modal for the repository and saves the result.
const editGitignore = (server, repoPath) => {
  return server
    .getPromise('/gitignore', { path: repoPath() })
    .then((res) => {
      return components.showModal('texteditmodal', {
        title: `${repoPath()}${ungit.config.fileSeparator}.gitignore`,
        content: res.content,
        closeFunc: (isYes) => {
          if (isYes) {
            server.putPromise('/gitignore', {
              path: repoPath(),
              data: document.querySelector('.modal-body .text-area-content').value,
            });
          }
        },
      });
    })
    .catch((e) => {
      // Not a git error but we are going to treat like one
      programEvents.dispatch({
        event: 'git-error',
        data: {
          command: `fs.write "${repoPath()}${ungit.config.fileSeparator}.gitignore"`,
          error: e.message || e.errorSummary,
          stdout: '',
          stderr: e.stack,
          repoPath: repoPath(),
        },
      });
    });
};

module.exports = { editGitignore };

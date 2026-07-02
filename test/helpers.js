// Starter Express-appen på en efemer port (listen(0)) for ikke-muterende røyktester.
// Importerer `app` fra server.js uten å trigge schema-init/backup/cron (require.main-guard).
const app = require('../server');

function startServer() {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://localhost:${port}`,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

module.exports = { startServer };

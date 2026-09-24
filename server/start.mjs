import { startFestivalServer } from './index.mjs';

// PM2 loads this module through its own process wrapper. Entry must not depend
// on process.argv[1], which can name the wrapper rather than this file.
startFestivalServer({ log: true }).then(app => {
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}).catch(error => { console.error(error.message); process.exitCode = 1; });

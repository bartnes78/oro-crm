// Engangs re-synk av Brreg-koblede investorer, slik at eksisterende koblinger
// får regnskapstall uten å vente på den ukentlige cron-synken.
// Kjør: node scripts/resync-brreg.js            → alle koblede
//       node scripts/resync-brreg.js --missing  → kun de uten regnskap-felt
require('dotenv').config();
const brreg    = require('../routes/brreg');
const { pool } = require('../db');

const onlyMissingRegnskap = process.argv.includes('--missing');

(async () => {
  try {
    console.log(`[resync-brreg] Starter engangs re-synk ${onlyMissingRegnskap ? '(kun manglende regnskap)' : '(alle koblede)'} …`);
    await brreg.brregSyncAll({ onlyMissingRegnskap });
    console.log('[resync-brreg] Ferdig.');
    process.exitCode = 0;
  } catch (e) {
    console.error('[resync-brreg] Feil:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    // routes/brreg.js registrerer en cron-timer ved require som ellers holder
    // event-loopen åpen — tving exit så skriptet avslutter.
    process.exit(process.exitCode || 0);
  }
})();

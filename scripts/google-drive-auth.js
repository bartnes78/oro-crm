// Engangs-oppsett for Google Disk-opplasting av ukentlig Excel-eksport.
//
// Forutsetter (gjøres i console.cloud.google.com, se ARCHITECTURE.md §8):
//   1. Prosjekt med Google Drive API aktivert
//   2. OAuth consent screen publisert («In production» — ellers utløper
//      refresh-tokenet etter 7 dager)
//   3. OAuth Client ID av typen «Desktop app»
//
// Kjør lokalt:  node scripts/google-drive-auth.js <client_id> <client_secret>
//
// Skriptet åpner en godkjenningsflyt i nettleseren, oppretter mappen
// «ORO CRM Backups» i din Disk, og skriver ut railway-kommandoen som setter
// de fire miljøvariablene. Ingen hemmeligheter lagres på disk.
const http   = require('http');
const crypto = require('crypto');

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Bruk: node scripts/google-drive-auth.js <client_id> <client_secret>');
  process.exit(1);
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file'; // kun filer appen selv oppretter

const server = http.createServer();
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}`;
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPE,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });

  console.log('\nÅpne denne lenken i nettleseren og godkjenn tilgangen:\n');
  console.log(authUrl + '\n');
  console.log('(venter på godkjenning ...)');

  server.on('request', async (req, res) => {
    const url = new URL(req.url, redirectUri);
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.get('state') !== state) {
      res.end('Ugyldig forespørsel'); return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<h2>Godkjent ✓</h2>Du kan lukke fanen og gå tilbake til terminalen.');
    server.close();

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokens.refresh_token)
        throw new Error('Fikk ikke refresh_token: ' + JSON.stringify(tokens));

      // Opprett backup-mappen — med drive.file-scope må appen selv eie mappen
      const folderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ORO CRM Backups', mimeType: 'application/vnd.google-apps.folder' }),
      });
      const folder = await folderRes.json();
      if (!folder.id) throw new Error('Kunne ikke opprette mappe: ' + JSON.stringify(folder));

      console.log('\n✓ Godkjent og mappe «ORO CRM Backups» opprettet i din Disk.\n');
      console.log('Kjør denne kommandoen for å aktivere opplastingen i Railway:\n');
      console.log(`railway variables --service oro-crm \\
  --set "GOOGLE_CLIENT_ID=${clientId}" \\
  --set "GOOGLE_CLIENT_SECRET=${clientSecret}" \\
  --set "GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}" \\
  --set "GOOGLE_DRIVE_FOLDER_ID=${folder.id}"\n`);
      console.log('(I PowerShell: bytt ut \\ på slutten av linjene med ` eller skriv alt på én linje)');
    } catch (e) {
      console.error('\nFeilet:', e.message);
      process.exit(1);
    }
  });
});

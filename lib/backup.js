const path    = require('path');
const fs      = require('fs');
const ExcelJS = require('exceljs');
const { query } = require('../db');

async function runBackup() {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const tables = [
    'investors', 'contacts', 'contact_log', 'tasks',
    'products', 'product_investors', 'declined_offers', 'users',
  ];
  try {
    for (const name of tables) {
      const { rows } = await query(`SELECT * FROM ${name}`);
      await query(
        'INSERT INTO backups (stamp, table_name, data) VALUES ($1,$2,$3) ON CONFLICT (stamp, table_name) DO UPDATE SET data = EXCLUDED.data',
        [stamp, name, JSON.stringify(rows)]
      );
    }
    const { rows: allStamps } = await query('SELECT DISTINCT stamp FROM backups ORDER BY stamp DESC');
    const toDelete = allStamps.slice(10).map(r => r.stamp);
    if (toDelete.length > 0) await query('DELETE FROM backups WHERE stamp = ANY($1)', [toDelete]);
    console.log(`[backup] ${stamp}`);
  } catch (e) {
    console.error('[backup] Feilet:', e.message);
  }
}

async function buildExcelWorkbook() {
  const [{ rows: investors }, { rows: contacts }, { rows: log }, { rows: products }, { rows: piRows }] = await Promise.all([
    query('SELECT * FROM investors WHERE deleted_at IS NULL ORDER BY name'),
    query('SELECT * FROM contacts'),
    query('SELECT * FROM contact_log ORDER BY date DESC'),
    query('SELECT * FROM products'),
    query(`SELECT pi.* FROM product_investors pi
           WHERE NOT EXISTS (
             SELECT 1 FROM declined_offers d
             WHERE d.investor_id = pi.investor_id AND d.product_id = pi.product_id
           )`),
  ]);
  const prodNameById = Object.fromEntries(products.map(p => [p.id, p.name]));
  const wb = new ExcelJS.Workbook();

  const piByInv = {};
  const prodsByInv = {};
  for (const pi of piRows) {
    if (!piByInv[pi.investor_id]) piByInv[pi.investor_id] = { ticket: 0, weighted: 0, committed: 0 };
    piByInv[pi.investor_id].ticket    += Number(pi.target_ticket)    || 0;
    piByInv[pi.investor_id].committed += Number(pi.committed_amount) || 0;
    if (pi.target_ticket != null && pi.probability != null)
      piByInv[pi.investor_id].weighted += Number(pi.target_ticket) * Number(pi.probability);
    if (!prodsByInv[pi.investor_id]) prodsByInv[pi.investor_id] = [];
    prodsByInv[pi.investor_id].push(pi.product_id);
  }

  const invRows = investors.map(i => {
    const pi = piByInv[i.id] || {};
    return {
      'ID': i.id, 'Navn': i.name, 'Land': i.country || '', 'By': i.city || '',
      'Type': i.investor_type || '', 'Fase': i.phase || '', 'Lead': i.lead || '',
      'Rådgiver': i.advisor || '',
      'Ticket totalt (MNOK)': pi.ticket ? Math.round(pi.ticket * 10) / 10 : '',
      'Vektet totalt (MNOK)': pi.weighted ? Math.round(pi.weighted * 10) / 10 : '',
      'Innbetalt (MNOK)': pi.committed ? Math.round(pi.committed * 10) / 10 : '',
      'Produktinteresse': (prodsByInv[i.id] || []).map(id => prodNameById[id] || id).join(', '),
      'Sist kontakt': i.last_contact || '', 'Neste steg': i.next_steps || '', 'Kommentarer': i.comments || '',
    };
  });
  const wsInv = wb.addWorksheet('Investorer');
  wsInv.columns = [
    { header: 'ID', key: 'ID', width: 10 }, { header: 'Navn', key: 'Navn', width: 36 },
    { header: 'Land', key: 'Land', width: 10 }, { header: 'By', key: 'By', width: 16 },
    { header: 'Type', key: 'Type', width: 18 }, { header: 'Fase', key: 'Fase', width: 14 },
    { header: 'Lead', key: 'Lead', width: 22 }, { header: 'Rådgiver', key: 'Rådgiver', width: 18 },
    { header: 'Ticket totalt (MNOK)', key: 'Ticket totalt (MNOK)', width: 16 },
    { header: 'Vektet totalt (MNOK)', key: 'Vektet totalt (MNOK)', width: 16 },
    { header: 'Innbetalt (MNOK)', key: 'Innbetalt (MNOK)', width: 14 },
    { header: 'Produktinteresse', key: 'Produktinteresse', width: 50 },
    { header: 'Sist kontakt', key: 'Sist kontakt', width: 14 },
    { header: 'Neste steg', key: 'Neste steg', width: 28 },
    { header: 'Kommentarer', key: 'Kommentarer', width: 40 },
  ];
  wsInv.addRows(invRows);

  const piSheetRows = piRows
    .filter(pi => pi.target_ticket != null || pi.committed_amount != null)
    .map(pi => {
      const inv = investors.find(i => i.id === pi.investor_id);
      const weighted = (pi.target_ticket != null && pi.probability != null)
        ? Math.round(Number(pi.target_ticket) * Number(pi.probability) * 10) / 10 : '';
      return {
        'Produkt': prodNameById[pi.product_id] || pi.product_id,
        'Investor': inv?.name || pi.investor_id,
        'Fase': inv?.phase || '',
        'Ticket (MNOK)': pi.target_ticket != null ? Number(pi.target_ticket) : '',
        'Sannsynlighet (%)': pi.probability != null ? Math.round(Number(pi.probability) * 100) : '',
        'Vektet (MNOK)': weighted,
        'Innbetalt (MNOK)': pi.committed_amount != null ? Number(pi.committed_amount) : '',
        'Avslagsgrunn': pi.decline_reason || '',
      };
    })
    .sort((a, b) => String(a['Produkt']).localeCompare(String(b['Produkt'])) || String(a['Investor']).localeCompare(String(b['Investor'])));
  const wsPi = wb.addWorksheet('Pipeline per produkt');
  wsPi.columns = [
    { header: 'Produkt', key: 'Produkt', width: 36 }, { header: 'Investor', key: 'Investor', width: 36 },
    { header: 'Fase', key: 'Fase', width: 14 }, { header: 'Ticket (MNOK)', key: 'Ticket (MNOK)', width: 14 },
    { header: 'Sannsynlighet (%)', key: 'Sannsynlighet (%)', width: 16 },
    { header: 'Vektet (MNOK)', key: 'Vektet (MNOK)', width: 14 },
    { header: 'Innbetalt (MNOK)', key: 'Innbetalt (MNOK)', width: 14 },
    { header: 'Avslagsgrunn', key: 'Avslagsgrunn', width: 24 },
  ];
  wsPi.addRows(piSheetRows);

  const invMap = Object.fromEntries(investors.map(i => [i.id, i.name]));
  const ctRows = contacts.map(c => ({
    'Investor ID': c.investor_id, 'Investor': invMap[c.investor_id] || '',
    'Navn': c.name || '', 'Tittel': c.title || '', 'E-post': c.email || '',
    'Telefon': c.phone || '', 'Telefon 2': c.phone2 || '', 'Primærkontakt': c.is_primary ? 'Ja' : '', 'Notater': c.notes || '',
  }));
  const wsCt = wb.addWorksheet('Kontakter');
  wsCt.columns = [
    { header: 'Investor ID', key: 'Investor ID', width: 10 }, { header: 'Investor', key: 'Investor', width: 30 },
    { header: 'Navn', key: 'Navn', width: 24 }, { header: 'Tittel', key: 'Tittel', width: 22 },
    { header: 'E-post', key: 'E-post', width: 28 }, { header: 'Telefon', key: 'Telefon', width: 16 },
    { header: 'Telefon 2', key: 'Telefon 2', width: 16 },
    { header: 'Primærkontakt', key: 'Primærkontakt', width: 14 }, { header: 'Notater', key: 'Notater', width: 36 },
  ];
  wsCt.addRows(ctRows);

  const logRows = log.map(l => ({
    'Dato': l.date || '', 'Investor ID': l.investor_id, 'Investor': invMap[l.investor_id] || l.investor_name || '',
    'Type': l.log_type || '', 'Kontaktperson': l.contact_person || '', 'Ansvarlig': l.responsible || '',
    'Emne': l.subject || '', 'Utfall': l.outcome || '', 'Notater': l.notes || '',
  }));
  const wsLog = wb.addWorksheet('Kontaktlogg');
  wsLog.columns = [
    { header: 'Dato', key: 'Dato', width: 12 }, { header: 'Investor ID', key: 'Investor ID', width: 10 },
    { header: 'Investor', key: 'Investor', width: 30 }, { header: 'Type', key: 'Type', width: 10 },
    { header: 'Kontaktperson', key: 'Kontaktperson', width: 22 }, { header: 'Ansvarlig', key: 'Ansvarlig', width: 22 },
    { header: 'Emne', key: 'Emne', width: 36 }, { header: 'Utfall', key: 'Utfall', width: 36 },
    { header: 'Notater', key: 'Notater', width: 50 },
  ];
  wsLog.addRows(logRows);

  return wb;
}

const EXPORT_DIR = path.join(__dirname, '..', 'data', 'exports');

function isoWeekStamp(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function runWeeklyExport() {
  try {
    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    const file = path.join(EXPORT_DIR, `ORO_CRM_${isoWeekStamp()}.xlsx`);
    if (fs.existsSync(file)) return;

    const wb = await buildExcelWorkbook();
    await wb.xlsx.writeFile(file);

    const files = (await fs.promises.readdir(EXPORT_DIR)).filter(f => f.endsWith('.xlsx')).sort();
    const toDelete = files.slice(0, -8);
    for (const f of toDelete) await fs.promises.unlink(path.join(EXPORT_DIR, f));

    console.log(`[weekly-export] ${file}`);
    if (process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET) {
      uploadToOneDrive(file, path.basename(file)).catch(e =>
        console.error('[weekly-export] OneDrive-opplasting feilet:', e.message)
      );
    }
  } catch (e) {
    console.error('[weekly-export] Feilet:', e.message);
  }
}

async function uploadToOneDrive(filePath, fileName) {
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  );
  const { access_token, error_description } = await tokenRes.json();
  if (!access_token) throw new Error('MS token feilet: ' + error_description);

  const user   = encodeURIComponent(process.env.MS_ONEDRIVE_USER   || '');
  const folder = encodeURIComponent(process.env.MS_ONEDRIVE_FOLDER || 'ORO CRM Backups');
  const fileContent = await fs.promises.readFile(filePath);

  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${user}/drive/root:/${folder}/${fileName}:/content`,
    {
      method:  'PUT',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type':  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: fileContent,
    }
  );
  if (!uploadRes.ok) {
    const msg = await uploadRes.text().catch(() => uploadRes.status);
    throw new Error(`Graph API ${uploadRes.status}: ${msg}`);
  }
  console.log(`[weekly-export] Lastet opp til OneDrive: ${fileName}`);
}

module.exports = { runBackup, buildExcelWorkbook, runWeeklyExport };

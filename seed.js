/**
 * Seed — importerer data fra ORO Investorer Master.xlsx til JSON-filer
 * Kjør: node seed.js
 */
const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');
const { write } = require('./db');

const EXCEL = path.join(__dirname, '..', 'ORO Investorer Master.xlsx');
if (!fs.existsSync(EXCEL)) {
  console.error('Finner ikke:', EXCEL);
  process.exit(1);
}

console.log('Leser:', EXCEL);
const wb = XLSX.readFile(EXCEL);

function ja(v)  { return String(v||'').trim().toLowerCase() === 'ja' ? 1 : 0; }
function str(v) { if (v==null) return null; const s=String(v).trim(); return (!s||s==='null'||s==='undefined') ? null : s; }
function num(v) { const n=parseFloat(v); return isNaN(n)?null:n; }
function dt(v)  {
  if (!v) return null;
  if (typeof v==='number') {
    const d=XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}` : null;
  }
  const s=String(v).trim();
  const m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : (s||null);
}

// ── Ark 1: Investorer ────────────────────────────────────────────────────────
const ws1  = wb.Sheets['Investorer'];
const rows = XLSX.utils.sheet_to_json(ws1, { header:1, defval:null });

let hdr = 0;
for (let i=0; i<rows.length; i++) { if (rows[i][0]==='ID') { hdr=i; break; } }

const investors = [];
for (let i=hdr+1; i<rows.length; i++) {
  const r=rows[i];
  const id=str(r[0]); const name=str(r[1]);
  if (!id||!name||id==='TOTALT') continue;
  investors.push({
    id, name,
    country:        str(r[2])||'Norge',
    investor_type:  str(r[3]),
    fund_vehicle:   str(r[4]),
    prosjekter:     ja(r[5]),
    value_add_fond: ja(r[6]),
    oro_areal:      ja(r[7]),
    phase:          str(r[8])||'Prospect',
    lead:           str(r[9]),
    advisor:        str(r[10]),
    target_ticket:  num(r[11]),
    probability:    num(r[12]),
    first_close:    ja(r[14]),
    source:         str(r[15]),
    next_steps:     str(r[16]),
    last_contact:   dt(r[17]),
    doc_shared:     dt(r[18]),
    meeting_date:   dt(r[19]),
    comments:       str(r[20]),
    updated_at:     new Date().toISOString(),
  });
}
write('investors', investors);
console.log(`Investorer importert: ${investors.length}`);

// ── Ark 2: Kontakter ─────────────────────────────────────────────────────────
const ws2   = wb.Sheets['Kontakter'];
const rows2 = XLSX.utils.sheet_to_json(ws2, { header:1, defval:null });

let hdr2 = 0;
for (let i=0; i<rows2.length; i++) { if (rows2[i][0]==='Investor-ID') { hdr2=i; break; } }

const invIds = new Set(investors.map(i=>i.id));
const contacts = [];
let cid = 1;
for (let i=hdr2+1; i<rows2.length; i++) {
  const r=rows2[i];
  const inv_id=str(r[0]); const name=str(r[2]);
  if (!inv_id||!name||!invIds.has(inv_id)) continue;
  contacts.push({ _id:cid++, investor_id:inv_id, name, title:str(r[3]),
    email:str(r[4]), phone:str(r[5]), is_primary:ja(r[6]), notes:str(r[7]) });
}
write('contacts', contacts);
console.log(`Kontakter importert: ${contacts.length}`);

write('log', []);
console.log('\nSeed fullført ✓  Kjør nå: npm run dev');

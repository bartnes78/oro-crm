const express = require('express');
const { query, pool } = require('../db');
const { fmtRow, fmtInvestor, validationError, requireAdmin, auditLog, normalizeName, jaccard } = require('../lib/helpers');
const { VALID_PHASES, VALID_TYPES, VALID_LEADS, VALID_VEHICLES } = require('../lib/validation');

const router = express.Router();

function validateInvestorBody(body, requireName = true) {
  const errors = [];
  if (requireName && !String(body.name || '').trim()) errors.push('Navn er påkrevd');
  if (body.phase         && !VALID_PHASES.includes(body.phase))         errors.push(`Ugyldig fase: ${body.phase}`);
  if (body.investor_type && !VALID_TYPES.includes(body.investor_type))  errors.push(`Ugyldig type: ${body.investor_type}`);
  if (body.lead          && !VALID_LEADS.includes(body.lead))           errors.push(`Ugyldig lead: ${body.lead}`);
  if (body.fund_vehicle  && !VALID_VEHICLES.includes(body.fund_vehicle))errors.push(`Ugyldig kjøretøy: ${body.fund_vehicle}`);
  if (body.product_interests != null && !Array.isArray(body.product_interests))
    errors.push('product_interests må være en liste');
  if (body.tags != null && (!Array.isArray(body.tags) || body.tags.some(t => typeof t !== 'string')))
    errors.push('tags må være en liste med tekst');
  return errors;
}

// Trim, dropp tomme, dedupliser (case-insensitivt, behold første skrivemåte)
function normalizeTags(arr) {
  const seen = new Set();
  const out = [];
  for (const t of (Array.isArray(arr) ? arr : [])) {
    const s = String(t).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ── Investorer ────────────────────────────────────────────────────────────────
router.get('/api/investors', async (req, res) => {
  try {
    const { search, phase, type, lead, product, country, city, tag } = req.query;
    const params = [];
    const where  = [];
    let join     = '';

    if (product) {
      params.push(parseInt(product));
      join = `JOIN product_investors pi ON pi.investor_id = i.id AND pi.product_id = $${params.length}`;
    }
    if (search)  { params.push('%' + search + '%');       where.push(`i.name ILIKE $${params.length}`); }
    if (phase)   { params.push(phase);                    where.push(`i.phase = $${params.length}`); }
    if (type)    { params.push(type);                     where.push(`i.investor_type = $${params.length}`); }
    if (lead)    { params.push(lead);                     where.push(`i.lead = $${params.length}`); }
    if (country) { params.push(country);                  where.push(`i.country = $${params.length}`); }
    if (city)    { params.push('%' + city + '%');          where.push(`i.city ILIKE $${params.length}`); }
    if (tag)     { params.push(JSON.stringify([tag]));     where.push(`i.tags @> $${params.length}`); }

    if (req.query.leads === '1') {
      where.push('i.is_lead = TRUE');
      if (req.query.includeDiscarded !== '1') where.push('i.discarded_at IS NULL');
    } else {
      where.push('i.is_lead IS NOT TRUE');
    }
    where.push('i.deleted_at IS NULL');
    const whereClause = 'WHERE ' + where.join(' AND ');
    let { rows } = await query(`SELECT i.* FROM investors i ${join} ${whereClause}`, params);

    if (product) {
      const pid = parseInt(product);
      const { rows: piRows } = await query('SELECT * FROM product_investors WHERE product_id = $1', [pid]);
      const piMap = Object.fromEntries(piRows.map(pi => [pi.investor_id, pi]));
      rows = rows.map(inv => {
        const pi = piMap[inv.id];
        return {
          ...inv,
          target_ticket:    pi?.target_ticket    ?? null,
          probability:      pi?.probability      ?? null,
          decline_reason:   pi?.decline_reason   ?? null,
          committed_amount: pi?.committed_amount ?? null,
        };
      });
    }

    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { rows: piAll } = await query(
        `SELECT pi.investor_id, pi.product_id, pi.target_ticket, pi.probability, pi.committed_amount, p.status
         FROM product_investors pi JOIN products p ON p.id = pi.product_id
         WHERE pi.investor_id = ANY($1)`, [ids]
      );
      const piMap = {};
      const aggMap = {};
      piAll.forEach(pi => {
        if (!piMap[pi.investor_id]) piMap[pi.investor_id] = [];
        piMap[pi.investor_id].push(pi.product_id);

        if (!aggMap[pi.investor_id]) aggMap[pi.investor_id] = { committed_total: 0, weighted_total: 0 };
        if (['Etablert', 'Avlyst'].includes(pi.status) && pi.committed_amount != null) {
          aggMap[pi.investor_id].committed_total += Number(pi.committed_amount);
        }
        if (['Fundraising', 'Pipeline'].includes(pi.status) && pi.target_ticket != null && pi.probability != null) {
          aggMap[pi.investor_id].weighted_total += Number(pi.target_ticket) * Number(pi.probability);
        }
      });
      const { rows: meetRows } = await query(
        `SELECT investor_id, MIN(date) AS next_meeting
         FROM contact_log
         WHERE investor_id = ANY($1) AND status = 'planlagt'
           AND log_type = 'Møte' AND date >= CURRENT_DATE
         GROUP BY investor_id`, [ids]
      );
      const meetMap = Object.fromEntries(meetRows.map(m => [m.investor_id, m.next_meeting]));

      rows = rows.map(r => ({
        ...r,
        product_interests: (piMap[r.id] || []).sort((a, b) => a - b),
        committed_total: aggMap[r.id]?.committed_total || 0,
        weighted_total:  aggMap[r.id]?.weighted_total  || 0,
        next_meeting:    meetMap[r.id] || null,
      }));
    }

    rows.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    res.json(rows.map(fmtInvestor));
  } catch (e) {
    console.error('[GET /investors]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/locations', async (req, res) => {
  try {
    const { rows } = await query('SELECT DISTINCT country, city FROM investors WHERE deleted_at IS NULL AND is_lead IS NOT TRUE');
    const countries = [...new Set(rows.map(r => r.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nb'));
    const cities    = [...new Set(rows.map(r => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nb'));
    res.json({ countries, cities });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Distinkte tags på tvers av aktive investorer — brukes til autocomplete/filter
router.get('/api/tags', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT DISTINCT tag
      FROM investors, jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS tag
      WHERE deleted_at IS NULL AND is_lead IS NOT TRUE
      ORDER BY tag
    `);
    res.json(rows.map(r => r.tag));
  } catch (e) {
    console.error('[GET /tags]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/investors', async (req, res) => {
  const errors = validateInvestorBody(req.body, true);
  if (errors.length) return validationError(res, errors);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: last } = await client.query(`SELECT id FROM investors WHERE id ~ '^INV-\\d+$' ORDER BY CAST(SUBSTRING(id FROM 5) AS INTEGER) DESC LIMIT 1 FOR UPDATE`);
    const maxNum = last.length ? parseInt(last[0].id.slice(4)) : 0;
    const id = 'INV-' + String(maxNum + 1).padStart(3, '0');

    const { rows: [inv] } = await client.query(`
      INSERT INTO investors
        (id, name, country, city, investor_type, fund_vehicle,
         phase, lead, advisor, first_close, next_steps, comments, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *
    `, [
      id, String(req.body.name).trim(), req.body.country || 'Norge', req.body.city || null,
      req.body.investor_type || null, null,
      req.body.phase || 'Prospekt', req.body.lead || null, req.body.advisor || null, 0,
      req.body.next_steps || null, req.body.comments || null,
    ]);
    const interests = Array.isArray(req.body.product_interests) ? req.body.product_interests : [];
    if (interests.length > 0) {
      await Promise.all(interests.map(pid =>
        client.query('INSERT INTO product_investors (product_id, investor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, id])
      ));
    }
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'create', 'investor', inv.id, null, { name: inv.name, phase: inv.phase, lead: inv.lead }, `Opprettet investor: ${inv.name}`);
    res.json({ ...fmtInvestor(inv), product_interests: interests });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /investors]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Må registreres før '/api/investors/:id', ellers fanges "trash" av :id-ruten (404)
router.get('/api/investors/trash', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT i.*, COUNT(c.id)::int AS contact_count
      FROM investors i
      LEFT JOIN contacts c ON c.investor_id = i.id
      WHERE i.deleted_at IS NOT NULL
      GROUP BY i.id
      ORDER BY i.deleted_at DESC
    `);
    res.json(rows.map(r => ({ ...fmtInvestor(r), deleted_at: r.deleted_at, contact_count: r.contact_count })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lett søk på tvers av ALLE ikke-slettede poster (leads + investorer), navn eller org.nr.
// Brukes av merge-plukker og relatert-selskap-plukker på investorkortet.
router.get('/api/investors/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const { rows } = await query(`
      SELECT id, name, org_nr, is_lead, phase, city
      FROM investors
      WHERE deleted_at IS NULL AND (name ILIKE $1 OR org_nr LIKE $2)
      ORDER BY (name ILIKE $3) DESC, name
      LIMIT 15
    `, ['%' + q + '%', q.replace(/\s/g, '') + '%', q + '%']);
    res.json(rows.map(r => ({ id: r.id, name: r.name, org_nr: r.org_nr, is_lead: !!r.is_lead, phase: r.phase, city: r.city })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/investors/:id', async (req, res) => {
  try {
    const { rows: invRows } = await query('SELECT * FROM investors WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!invRows[0]) return res.status(404).json({ error: 'Not found' });
    const [{ rows: contacts }, { rows: log }, { rows: piRows }, { rows: declinedRows }] = await Promise.all([
      query('SELECT * FROM contacts WHERE investor_id = $1 ORDER BY is_primary DESC', [req.params.id]),
      query('SELECT * FROM contact_log WHERE investor_id = $1 ORDER BY date DESC', [req.params.id]),
      query('SELECT product_id FROM product_investors WHERE investor_id = $1', [req.params.id]),
      query('SELECT product_id, decline_reason, declined_at FROM declined_offers WHERE investor_id = $1 ORDER BY declined_at DESC', [req.params.id]),
    ]);
    const inv = {
      ...invRows[0],
      product_interests: piRows.map(r => r.product_id).sort((a, b) => a - b),
      declined_offers:   declinedRows,
    };
    // Relaterte personer: alle personer koblet til denne investoren, + hver persons øvrige selskaper
    const { rows: relRows } = await query(`
      SELECT pc.person_id, p.name AS person_name, pc.company_name, pc.investor_id,
             pc.rolle, pc.relation, pc.verified, i.name AS crm_name, i.is_lead AS crm_is_lead
      FROM person_companies pc
      JOIN persons p ON p.id = pc.person_id
      LEFT JOIN investors i ON i.id = pc.investor_id AND i.deleted_at IS NULL
      WHERE pc.person_id IN (SELECT person_id FROM person_companies WHERE investor_id = $1)
      ORDER BY p.name, (pc.investor_id IS NULL), pc.company_name
    `, [req.params.id]);
    const personMap = {};
    for (const r of relRows) {
      (personMap[r.person_id] = personMap[r.person_id] || { person_id: r.person_id, name: r.person_name, companies: [] })
        .companies.push({ company_name: r.company_name, investor_id: r.investor_id, crm_name: r.crm_name, crm_is_lead: r.crm_is_lead, rolle: r.rolle, relation: r.relation, verified: r.verified });
    }
    // Assosierte selskaper (direkte selskap-til-selskap, begge retninger)
    const { rows: assocRows } = await query(`
      SELECT CASE WHEN a.a_id = $1 THEN a.b_id ELSE a.a_id END AS other_id,
             a.relation, a.note,
             i.name AS other_name, i.is_lead AS other_is_lead, i.phase AS other_phase
      FROM investor_associations a
      JOIN investors i ON i.id = CASE WHEN a.a_id = $1 THEN a.b_id ELSE a.a_id END AND i.deleted_at IS NULL
      WHERE a.a_id = $1 OR a.b_id = $1
      ORDER BY i.name
    `, [req.params.id]);
    const associations = assocRows.map(r => ({
      investor_id: r.other_id, name: r.other_name, is_lead: !!r.other_is_lead, phase: r.other_phase,
      relation: r.relation, note: r.note,
    }));
    res.json({ ...fmtInvestor(inv), contacts: contacts.map(fmtRow), log: log.map(fmtRow), related_persons: Object.values(personMap), associations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/investors/:id', async (req, res) => {
  const errors = validateInvestorBody(req.body, false);
  if (errors.length) return validationError(res, errors);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM investors WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const cur = rows[0];
    const b   = req.body;
    const v   = k => (k in b ? b[k] : cur[k]);
    const vNull = k => (k in b ? (b[k] || null) : cur[k]);

    const { rows: [updated] } = await client.query(`
      UPDATE investors SET
        name=$2, country=$3, city=$4, investor_type=$5, fund_vehicle=$6,
        phase=$7, lead=$8, advisor=$9,
        first_close=$10, source=$11,
        next_steps=$12, last_contact=$13, doc_shared=$14, meeting_date=$15,
        comments=$16, docs=$17, is_lead=$18, tags=$19, updated_at=NOW()
      WHERE id=$1 RETURNING *
    `, [
      req.params.id,
      v('name'), v('country'), vNull('city'), vNull('investor_type'), vNull('fund_vehicle'),
      v('phase'), vNull('lead'), vNull('advisor'),
      v('first_close') || 0, vNull('source'), vNull('next_steps'),
      vNull('last_contact'), vNull('doc_shared'), vNull('meeting_date'), vNull('comments'),
      JSON.stringify('docs' in b ? (b.docs || {}) : (cur.docs || {})),
      'is_lead' in b ? !!b.is_lead : cur.is_lead,
      JSON.stringify('tags' in b ? normalizeTags(b.tags) : (cur.tags || [])),
    ]);

    let newInterests = null;
    if ('product_interests' in b) {
      const newIds = (Array.isArray(b.product_interests) ? b.product_interests : []).map(Number);
      const { rows: existing } = await client.query('SELECT product_id FROM product_investors WHERE investor_id = $1', [req.params.id]);
      const existingIds = existing.map(r => r.product_id);
      const toAdd    = newIds.filter(id => !existingIds.includes(id));
      const toRemove = existingIds.filter(id => !newIds.includes(id));
      if (toAdd.length > 0)
        await Promise.all(toAdd.map(pid =>
          client.query('INSERT INTO product_investors (product_id, investor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, req.params.id])
        ));
      if (toRemove.length > 0)
        await client.query('DELETE FROM product_investors WHERE investor_id=$1 AND product_id=ANY($2)', [req.params.id, toRemove]);
      newInterests = newIds;
    } else {
      const { rows: piRows } = await client.query('SELECT product_id FROM product_investors WHERE investor_id = $1', [req.params.id]);
      newInterests = piRows.map(r => r.product_id).sort((a, b) => a - b);
    }

    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'investor', req.params.id,
      { name: cur.name, phase: cur.phase, lead: cur.lead },
      { name: updated.name, phase: updated.phase, lead: updated.lead },
      `Oppdaterte investor: ${updated.name}`);
    res.json({ ...fmtInvestor(updated), product_interests: newInterests });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[PUT /investors]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.delete('/api/investors/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const { rows } = await query('SELECT * FROM investors WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Investor ikke funnet' });
    const inv = rows[0];
    await query('UPDATE investors SET deleted_at = NOW() WHERE id = $1', [id]);
    await auditLog(req.currentUser._id, req.currentUser.username, 'delete', 'investor', id, { name: inv.name, phase: inv.phase, lead: inv.lead }, null, `Flyttet til papirkurv: ${inv.name}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Kvalifiser et lead → promoter til ekte investor (is_lead=FALSE, fase Prospekt).
// Tilgjengelig for alle innloggede — dette er kjerne-lead-arbeidet.
router.post('/api/investors/:id/qualify', async (req, res) => {
  const id = req.params.id;
  try {
    const { rows } = await query('SELECT * FROM investors WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Lead ikke funnet' });
    const inv = rows[0];
    if (!inv.is_lead) return res.status(400).json({ error: 'Allerede kvalifisert' });
    const { rows: [u] } = await query(
      `UPDATE investors SET is_lead = FALSE, phase = 'Prospekt', updated_at = NOW() WHERE id = $1 RETURNING *`, [id]);
    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'investor', id,
      { is_lead: true, phase: inv.phase }, { is_lead: false, phase: 'Prospekt' },
      `Kvalifiserte lead til investor: ${u.name}`);
    res.json(fmtInvestor(u));
  } catch (e) {
    console.error('[POST /qualify]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Forkast/gjenopprett et lead (avvist men beholdt — ikke papirkurv).
router.post('/api/investors/:id/discard', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const discarded = !!req.body.discarded;
  try {
    const { rows } = await query('SELECT * FROM investors WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Ikke funnet' });
    const { rows: [u] } = await query(
      `UPDATE investors SET discarded_at = ${discarded ? 'NOW()' : 'NULL'}, discarded_by = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, discarded ? (req.currentUser?.username || null) : null]
    );
    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'investor', id,
      { discarded: !discarded }, { discarded },
      `${discarded ? 'Forkastet' : 'Gjenopprettet'} lead: ${u.name}`);
    res.json(fmtInvestor(u));
  } catch (e) {
    console.error('[POST /discard]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/investors/:id/restore', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const { rows } = await query('SELECT * FROM investors WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Investor ikke funnet i papirkurven' });
    await query('UPDATE investors SET deleted_at = NULL WHERE id = $1', [id]);
    await auditLog(req.currentUser._id, req.currentUser.username, 'restore', 'investor', id, null, { name: rows[0].name }, `Gjenopprettet investor: ${rows[0].name}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Duplikater ────────────────────────────────────────────────────────────────
// normalizeName/jaccard er flyttet til lib/helpers.js (delt med lead-importøren).

router.get('/api/duplicates', async (req, res) => {
  try {
    const { rows: investors } = await query('SELECT * FROM investors WHERE deleted_at IS NULL AND is_lead IS NOT TRUE');
    const pairs = [];
    for (let i = 0; i < investors.length; i++) {
      for (let j = i + 1; j < investors.length; j++) {
        const score = jaccard(normalizeName(investors[i].name), normalizeName(investors[j].name));
        if (score >= 0.6) pairs.push({ score: Math.round(score * 100), a: fmtInvestor(investors[i]), b: fmtInvestor(investors[j]) });
      }
    }
    res.json(pairs.sort((a, b) => b.score - a.score));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Per lead: beste duplikat-treff mot ALLE ikke-slettede (investorer + andre leads).
// Brukes i leads-lista for å flagge overlapp raskt før kvalifisering.
router.get('/api/leads/duplicates', async (req, res) => {
  try {
    const { rows: all } = await query('SELECT id, name, is_lead FROM investors WHERE deleted_at IS NULL');
    const norm = all.map(r => ({ ...r, n: normalizeName(r.name) }));
    const leads = norm.filter(r => r.is_lead);
    const result = {};
    for (const lead of leads) {
      let best = null;
      for (const other of norm) {
        if (other.id === lead.id) continue;
        const score = jaccard(lead.n, other.n);
        if (score < 0.6) continue;
        // Høyest score vinner; ved lik score foretrekk kvalifisert investor (klart merge-mål).
        const better = !best || score > best.score || (score === best.score && best.is_lead && !other.is_lead);
        if (better) best = { id: other.id, name: other.name, is_lead: other.is_lead, score };
      }
      if (best) result[lead.id] = { ...best, score: Math.round(best.score * 100) };
    }
    res.json(result);
  } catch (e) {
    console.error('[GET /leads/duplicates]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/duplicate-contacts', async (req, res) => {
  try {
    const [{ rows: contacts }, { rows: investors }] = await Promise.all([
      query('SELECT * FROM contacts'),
      query('SELECT id, name FROM investors WHERE deleted_at IS NULL'),
    ]);
    const invMap = Object.fromEntries(investors.map(i => [i.id, i.name]));
    const groups = [];

    const byInvName = {};
    contacts.forEach(c => {
      const key = c.investor_id + '||' + (c.name || '').trim().toLowerCase();
      if (!byInvName[key]) byInvName[key] = [];
      byInvName[key].push(fmtRow(c));
    });
    Object.values(byInvName).forEach(cs => {
      if (cs.length > 1) groups.push({ type: 'exact', label: 'Samme navn, samme investor',
        investor_name: invMap[cs[0].investor_id] || cs[0].investor_id,
        investor_id: cs[0].investor_id, contacts: cs });
    });

    const byEmail = {};
    contacts.forEach(c => {
      const e = (c.email || '').trim().toLowerCase();
      if (!e) return;
      if (!byEmail[e]) byEmail[e] = [];
      byEmail[e].push(fmtRow(c));
    });
    Object.entries(byEmail).forEach(([email, cs]) => {
      if (cs.length > 1) {
        const investorIds = [...new Set(cs.map(c => c.investor_id))];
        groups.push({ type: 'email', label: 'Samme e-postadresse', email,
          investor_ids: investorIds,
          investor_names: investorIds.map(id => invMap[id] || id),
          contacts: cs.map(c => ({ ...c, investor_name: invMap[c.investor_id] || c.investor_id })) });
      }
    });

    res.json(groups.sort((a, b) => (a.type === 'exact' ? -1 : 1)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/merge', requireAdmin, async (req, res) => {
  const { keep_id, drop_id } = req.body;
  if (!keep_id || !drop_id) return res.status(400).json({ error: 'keep_id og drop_id er påkrevd' });

  const client = await pool.connect();
  try {
    const [{ rows: keepRows }, { rows: dropRows }] = await Promise.all([
      client.query('SELECT * FROM investors WHERE id = $1', [keep_id]),
      client.query('SELECT * FROM investors WHERE id = $1', [drop_id]),
    ]);
    if (!keepRows[0] || !dropRows[0]) return res.status(404).json({ error: 'Investor ikke funnet' });

    const keep = keepRows[0];
    const drop = dropRows[0];
    const merged = { ...keep };
    for (const key of Object.keys(drop)) {
      if (key === 'id' || key === 'updated_at' || key === 'deleted_at') continue;
      if (merged[key] == null || merged[key] === '' || merged[key] === 0) {
        if (drop[key] != null && drop[key] !== '' && drop[key] !== 0) merged[key] = drop[key];
      }
    }
    if (keep.comments && drop.comments && keep.comments !== drop.comments)
      merged.comments = keep.comments + ' | ' + drop.comments;
    // Brreg-kobling følger org_nr som en enhet — ellers kan keep ende med drops
    // org_nr men eget (tomt) brreg_data
    if (!keep.org_nr && drop.org_nr) {
      merged.org_nr     = drop.org_nr;
      merged.brreg_navn = drop.brreg_navn;
      merged.brreg_data = drop.brreg_data;
    }
    merged.docs = { ...(drop.docs || {}), ...(keep.docs || {}) };
    // Union tags (bevar kilde-tags fra begge) — dedup case-insensitivt
    const seenTag = new Set();
    merged.tags = [...(keep.tags || []), ...(drop.tags || [])]
      .filter(t => { const k = String(t).toLowerCase(); if (seenTag.has(k)) return false; seenTag.add(k); return true; });

    await client.query('BEGIN');
    await client.query('UPDATE contacts SET investor_id=$1 WHERE investor_id=$2', [keep_id, drop_id]);
    await client.query('UPDATE contact_log SET investor_id=$1, investor_name=$2 WHERE investor_id=$3', [keep_id, keep.name, drop_id]);
    await client.query('UPDATE tasks SET investor_id=$1, investor_name=$2 WHERE investor_id=$3', [keep_id, keep.name, drop_id]);
    // Kopier drop's produktkoblinger til keep — behold keep's verdier ved konflikt
    await client.query(`
      INSERT INTO product_investors (product_id, investor_id, target_ticket, probability, committed_amount, decline_reason)
      SELECT product_id, $1, target_ticket, probability, committed_amount, decline_reason
      FROM product_investors WHERE investor_id = $2
      ON CONFLICT (product_id, investor_id) DO NOTHING
    `, [keep_id, drop_id]);
    // Flytt avslagshistorikk — CASCADE ville ellers slettet den sammen med drop-investoren
    await client.query(`
      INSERT INTO declined_offers (product_id, investor_id, decline_reason, declined_at)
      SELECT product_id, $1, decline_reason, declined_at
      FROM declined_offers WHERE investor_id = $2
      ON CONFLICT (product_id, investor_id) DO NOTHING
    `, [keep_id, drop_id]);
    // Slett drop før keep oppdateres — org_nr har unik indeks og må frigis først
    await client.query('DELETE FROM investors WHERE id=$1', [drop_id]);
    await client.query(`
      UPDATE investors SET name=$2, country=$3, city=$4, investor_type=$5, fund_vehicle=$6,
        phase=$7, lead=$8, advisor=$9, source=$10, next_steps=$11,
        last_contact=$12, doc_shared=$13, meeting_date=$14, comments=$15, docs=$16,
        org_nr=$17, brreg_navn=$18, brreg_data=$19, tags=$20, updated_at=NOW()
      WHERE id=$1
    `, [keep_id, merged.name, merged.country, merged.city, merged.investor_type, merged.fund_vehicle,
        merged.phase, merged.lead, merged.advisor, merged.source, merged.next_steps,
        merged.last_contact, merged.doc_shared, merged.meeting_date, merged.comments,
        JSON.stringify(merged.docs || {}), merged.org_nr || null, merged.brreg_navn || null,
        JSON.stringify(merged.brreg_data || {}), JSON.stringify(merged.tags || [])]);
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'merge', 'investor', keep_id,
      { dropped_id: drop_id, dropped_name: drop.name },
      { kept_id: keep_id, kept_name: keep.name },
      `Slo sammen ${drop.name} (${drop_id}) inn i ${keep.name} (${keep_id})`);

    const { rows: [final] } = await client.query('SELECT * FROM investors WHERE id=$1', [keep_id]);
    const { rows: finalPi } = await client.query('SELECT product_id FROM product_investors WHERE investor_id=$1', [keep_id]);
    res.json({ ok: true, merged: { ...fmtInvestor(final), product_interests: finalPi.map(r => r.product_id).sort((a, b) => a - b) } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[merge]', e.message);
    res.status(500).json({ error: 'Sammenslåing feilet' });
  } finally {
    client.release();
  }
});

// ── Personer / relaterte selskaper ────────────────────────────────────────────
router.post('/api/persons/:id/main', async (req, res) => {
  const personId = req.params.id;
  const { investor_id } = req.body;
  if (!investor_id) return validationError(res, ['investor_id er påkrevd']);
  try {
    await query(`UPDATE person_companies SET relation = NULL WHERE person_id = $1 AND relation = 'hovedselskap'`, [personId]);
    const { rowCount } = await query(`UPDATE person_companies SET relation = 'hovedselskap' WHERE person_id = $1 AND investor_id = $2`, [personId, investor_id]);
    if (!rowCount) return res.status(404).json({ error: 'Kobling ikke funnet' });
    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'person', personId, null, { hovedselskap: investor_id }, `Satte hovedselskap for person ${personId}: ${investor_id}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/persons/:id/create-lead', async (req, res) => {
  const personId = req.params.id;
  const { company_name } = req.body;
  if (!company_name) return validationError(res, ['company_name er påkrevd']);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pcRows } = await client.query('SELECT * FROM person_companies WHERE person_id=$1 AND company_name=$2', [personId, company_name]);
    if (!pcRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Kobling ikke funnet' }); }
    if (pcRows[0].investor_id) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Selskapet er allerede i CRM' }); }
    const { rows: last } = await client.query(`SELECT id FROM investors WHERE id ~ '^INV-\\d+$' ORDER BY CAST(SUBSTRING(id FROM 5) AS INTEGER) DESC LIMIT 1 FOR UPDATE`);
    const id = 'INV-' + String((last.length ? parseInt(last[0].id.slice(4)) : 0) + 1).padStart(3, '0');
    const { rows: [inv] } = await client.query(
      `INSERT INTO investors (id, name, country, phase, is_lead, source, updated_at) VALUES ($1,$2,'Norge','Prospekt',TRUE,$3,NOW()) RETURNING *`,
      [id, String(company_name).trim(), 'relatert selskap']
    );
    await client.query(`UPDATE person_companies SET investor_id=$1, verified=TRUE WHERE person_id=$2 AND company_name=$3`, [id, personId, company_name]);
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'create', 'investor', id, null, { name: inv.name, from_person: personId }, `Opprettet lead fra relatert selskap: ${inv.name}`);
    res.json(fmtInvestor(inv));
  } catch (e) {
    await client.query('ROLLBACK'); console.error('[create-lead]', e.message); res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

const VALID_RELATIONS = ['hovedselskap', 'investeringsselskap', 'eiendom', 'konsern', 'familie', 'annet'];

async function upsertPerson(client, name) {
  const { rows } = await client.query(
    `INSERT INTO persons (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [String(name).trim()]
  );
  return rows[0].id;
}

// Koble en person (opprettes ved behov) til DETTE selskapet — gjør at personen
// dukker opp på kortet. Herfra kan flere selskaper legges til personen.
router.post('/api/investors/:id/persons', async (req, res) => {
  const { person_name, rolle, relation } = req.body;
  if (!String(person_name || '').trim()) return validationError(res, ['Personnavn er påkrevd']);
  if (relation && !VALID_RELATIONS.includes(relation)) return validationError(res, [`Ugyldig relasjon: ${relation}`]);
  const client = await pool.connect();
  try {
    const { rows: invRows } = await client.query('SELECT id, name, org_nr FROM investors WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!invRows[0]) return res.status(404).json({ error: 'Investor ikke funnet' });
    const inv = invRows[0];
    await client.query('BEGIN');
    const pid = await upsertPerson(client, person_name);
    await client.query(
      `INSERT INTO person_companies (person_id, investor_id, company_name, org_nr, relation, rolle, source, verified)
       VALUES ($1,$2,$3,$4,$5,$6,'manuell',TRUE)
       ON CONFLICT (person_id, company_name)
       DO UPDATE SET investor_id=EXCLUDED.investor_id, org_nr=COALESCE(EXCLUDED.org_nr, person_companies.org_nr),
                     relation=COALESCE(EXCLUDED.relation, person_companies.relation),
                     rolle=COALESCE(EXCLUDED.rolle, person_companies.rolle), verified=TRUE`,
      [pid, inv.id, inv.name, inv.org_nr || null, relation || null, String(rolle || '').trim() || null]
    );
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'create', 'person', String(pid), null, { investor_id: inv.id, person: String(person_name).trim() }, `Koblet person «${String(person_name).trim()}» til ${inv.name}`);
    res.json({ ok: true, person_id: pid });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /investors/:id/persons]', e.message); res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// Legg til enda et selskap på en eksisterende person (eksisterende investor eller fritekst/eksternt).
router.post('/api/persons/:id/companies', async (req, res) => {
  const personId = req.params.id;
  let { company_name, investor_id, org_nr, relation, rolle } = req.body;
  if (relation && !VALID_RELATIONS.includes(relation)) return validationError(res, [`Ugyldig relasjon: ${relation}`]);
  const client = await pool.connect();
  try {
    const { rows: pRows } = await client.query('SELECT id FROM persons WHERE id=$1', [personId]);
    if (!pRows[0]) return res.status(404).json({ error: 'Person ikke funnet' });
    if (investor_id) {
      const { rows: iRows } = await client.query('SELECT id, name, org_nr FROM investors WHERE id=$1 AND deleted_at IS NULL', [investor_id]);
      if (!iRows[0]) return res.status(404).json({ error: 'Investor ikke funnet' });
      company_name = iRows[0].name;
      org_nr = org_nr || iRows[0].org_nr;
    }
    if (!String(company_name || '').trim()) return validationError(res, ['Selskapsnavn eller investor er påkrevd']);
    await client.query(
      `INSERT INTO person_companies (person_id, investor_id, company_name, org_nr, relation, rolle, source, verified)
       VALUES ($1,$2,$3,$4,$5,$6,'manuell',TRUE)
       ON CONFLICT (person_id, company_name)
       DO UPDATE SET investor_id=COALESCE(EXCLUDED.investor_id, person_companies.investor_id),
                     org_nr=COALESCE(EXCLUDED.org_nr, person_companies.org_nr),
                     relation=COALESCE(EXCLUDED.relation, person_companies.relation),
                     rolle=COALESCE(EXCLUDED.rolle, person_companies.rolle), verified=TRUE`,
      [personId, investor_id || null, String(company_name).trim(), String(org_nr || '').replace(/\s/g, '') || null, relation || null, String(rolle || '').trim() || null]
    );
    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'person', String(personId), null, { company: String(company_name).trim() }, `La til selskap «${String(company_name).trim()}» på person ${personId}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /persons/:id/companies]', e.message); res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// Fjern en person-selskap-kobling (feilkobling). Personen slettes automatisk (CASCADE) hvis siste kobling forsvinner? Nei — vi rydder eksplisitt.
router.delete('/api/persons/:id/companies', async (req, res) => {
  const personId = req.params.id;
  const { company_name } = req.body;
  if (!String(company_name || '').trim()) return validationError(res, ['company_name er påkrevd']);
  try {
    const { rowCount } = await query('DELETE FROM person_companies WHERE person_id=$1 AND company_name=$2', [personId, String(company_name).trim()]);
    if (!rowCount) return res.status(404).json({ error: 'Kobling ikke funnet' });
    await query('DELETE FROM persons p WHERE p.id=$1 AND NOT EXISTS (SELECT 1 FROM person_companies pc WHERE pc.person_id=p.id)', [personId]);
    await auditLog(req.currentUser._id, req.currentUser.username, 'delete', 'person', String(personId), { company: String(company_name).trim() }, null, `Fjernet kobling «${String(company_name).trim()}» fra person ${personId}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Assosierte selskaper (direkte selskap-til-selskap, symmetrisk) ─────────────
const VALID_ASSOC = ['assosiert', 'kontaktpunkt', 'konsern', 'eiendom', 'annet'];

router.post('/api/investors/:id/associations', async (req, res) => {
  const { other_id, relation, note } = req.body;
  if (!other_id) return validationError(res, ['other_id er påkrevd']);
  if (String(other_id) === String(req.params.id)) return validationError(res, ['Kan ikke koble en post til seg selv']);
  if (relation && !VALID_ASSOC.includes(relation)) return validationError(res, [`Ugyldig relasjon: ${relation}`]);
  try {
    const { rows } = await query('SELECT id FROM investors WHERE id = ANY($1) AND deleted_at IS NULL', [[req.params.id, other_id]]);
    if (rows.length < 2) return res.status(404).json({ error: 'Fant ikke begge postene' });
    const [a_id, b_id] = [req.params.id, other_id].sort();  // kanonisk rekkefølge
    await query(
      `INSERT INTO investor_associations (a_id, b_id, relation, note) VALUES ($1,$2,$3,$4)
       ON CONFLICT (a_id, b_id) DO UPDATE SET relation=EXCLUDED.relation, note=EXCLUDED.note`,
      [a_id, b_id, relation || null, String(note || '').trim() || null]
    );
    await auditLog(req.currentUser._id, req.currentUser.username, 'update', 'investor', req.params.id, null, { assosiert: other_id, relation: relation || null }, `Koblet assosiert selskap ${other_id} til ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) { console.error('[POST associations]', e.message); res.status(500).json({ error: e.message }); }
});

router.delete('/api/investors/:id/associations', async (req, res) => {
  const { other_id } = req.body;
  if (!other_id) return validationError(res, ['other_id er påkrevd']);
  try {
    const [a_id, b_id] = [req.params.id, other_id].sort();
    const { rowCount } = await query('DELETE FROM investor_associations WHERE a_id=$1 AND b_id=$2', [a_id, b_id]);
    if (!rowCount) return res.status(404).json({ error: 'Kobling ikke funnet' });
    await auditLog(req.currentUser._id, req.currentUser.username, 'delete', 'investor', req.params.id, { assosiert: other_id }, null, `Fjernet assosiert selskap ${other_id} fra ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

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
  return errors;
}

// ── Investorer ────────────────────────────────────────────────────────────────
router.get('/api/investors', async (req, res) => {
  try {
    const { search, phase, type, lead, product, country, city } = req.query;
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

    where.push(req.query.leads === '1' ? 'i.is_lead = TRUE' : 'i.is_lead IS NOT TRUE');
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
      rows = rows.map(r => ({
        ...r,
        product_interests: (piMap[r.id] || []).sort((a, b) => a - b),
        committed_total: aggMap[r.id]?.committed_total || 0,
        weighted_total:  aggMap[r.id]?.weighted_total  || 0,
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
    res.json({ ...fmtInvestor(inv), contacts: contacts.map(fmtRow), log: log.map(fmtRow) });
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
        comments=$16, docs=$17, is_lead=$18, updated_at=NOW()
      WHERE id=$1 RETURNING *
    `, [
      req.params.id,
      v('name'), v('country'), vNull('city'), vNull('investor_type'), vNull('fund_vehicle'),
      v('phase'), vNull('lead'), vNull('advisor'),
      v('first_close') || 0, vNull('source'), vNull('next_steps'),
      vNull('last_contact'), vNull('doc_shared'), vNull('meeting_date'), vNull('comments'),
      JSON.stringify('docs' in b ? (b.docs || {}) : (cur.docs || {})),
      'is_lead' in b ? !!b.is_lead : cur.is_lead,
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
        org_nr=$17, brreg_navn=$18, brreg_data=$19, updated_at=NOW()
      WHERE id=$1
    `, [keep_id, merged.name, merged.country, merged.city, merged.investor_type, merged.fund_vehicle,
        merged.phase, merged.lead, merged.advisor, merged.source, merged.next_steps,
        merged.last_contact, merged.doc_shared, merged.meeting_date, merged.comments,
        JSON.stringify(merged.docs || {}), merged.org_nr || null, merged.brreg_navn || null,
        JSON.stringify(merged.brreg_data || {})]);
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

module.exports = router;

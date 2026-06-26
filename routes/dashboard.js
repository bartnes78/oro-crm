const router = require('express').Router();
const { query } = require('../db');
const { fmtRow, fmtInvestor } = require('../lib/helpers');

// ── Analyse ───────────────────────────────────────────────────────────────────
router.get('/api/analyse', async (req, res) => {
  try {
    const [{ rows: products }, { rows: piRows }, { rows: investors }, { rows: logRows }] = await Promise.all([
      query('SELECT * FROM products ORDER BY id'),
      query(`SELECT pi.product_id, pi.investor_id, pi.target_ticket, pi.probability, pi.committed_amount
             FROM product_investors pi
             WHERE NOT EXISTS (
               SELECT 1 FROM declined_offers d
               WHERE d.investor_id = pi.investor_id AND d.product_id = pi.product_id
             )`),
      query('SELECT id, phase, investor_type FROM investors WHERE deleted_at IS NULL'),
      query(`SELECT DATE_TRUNC('month', date)::date AS month, COUNT(*)::int AS count, responsible
             FROM contact_log
             WHERE date >= NOW() - INTERVAL '13 months'
             GROUP BY 1, 3 ORDER BY 1`),
    ]);

    const invMap = Object.fromEntries(investors.map(i => [i.id, i]));

    const fundStats = products.map(p => {
      const pis = piRows.filter(pi => pi.product_id === p.id);
      const ticket    = pis.reduce((s, pi) => s + (Number(pi.target_ticket) || 0), 0);
      const weighted  = pis.reduce((s, pi) => s + (pi.target_ticket != null && pi.probability != null
        ? Number(pi.target_ticket) * Number(pi.probability) : 0), 0);
      const signedPis = pis.filter(pi => Number(pi.committed_amount) > 0);
      const signedTicket = signedPis.reduce((s, pi) => s + (Number(pi.committed_amount) || Number(pi.target_ticket) || 0), 0);
      return {
        id: p.id, name: p.name, target_size: p.target_size, status: p.status,
        investorCount: pis.length,
        ticket:       Math.round(ticket * 10) / 10,
        weighted:     Math.round(weighted * 10) / 10,
        signedCount:  signedPis.length,
        signedTicket: Math.round(signedTicket * 10) / 10,
      };
    });

    const monthTotals = {};
    logRows.forEach(r => {
      const m = String(r.month).slice(0, 7);
      monthTotals[m] = (monthTotals[m] || 0) + r.count;
    });

    const respMap = {};
    logRows.forEach(r => {
      if (!r.responsible) return;
      respMap[r.responsible] = (respMap[r.responsible] || 0) + r.count;
    });
    const byResponsible = Object.entries(respMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const phaseMap = {};
    investors.forEach(i => {
      const p = i.phase || 'Ukjent';
      if (!phaseMap[p]) phaseMap[p] = { phase: p, count: 0 };
      phaseMap[p].count++;
    });
    const byPhase = Object.values(phaseMap).sort((a, b) => b.count - a.count);

    const typeMap = {};
    piRows.forEach(pi => {
      const inv = invMap[pi.investor_id];
      if (!inv) return;
      const t = inv.investor_type || 'Ukjent';
      if (!typeMap[t]) typeMap[t] = { type: t, count: 0, ticket: 0 };
      typeMap[t].ticket += Number(pi.target_ticket) || 0;
    });
    investors.forEach(i => {
      const t = i.investor_type || 'Ukjent';
      if (!typeMap[t]) typeMap[t] = { type: t, count: 0, ticket: 0 };
      typeMap[t].count++;
    });
    const byType = Object.values(typeMap)
      .map(t => ({ ...t, ticket: Math.round(t.ticket * 10) / 10 }))
      .sort((a, b) => b.ticket - a.ticket);

    const activeProductIds = new Set(products.filter(p => p.status === 'Pipeline' || p.status === 'Fundraising').map(p => p.id));
    const invAgg = {};
    piRows.forEach(pi => {
      const inv = invMap[pi.investor_id];
      if (!inv) return;
      if (!invAgg[pi.investor_id]) invAgg[pi.investor_id] = { id: pi.investor_id, name: '', phase: inv.phase, type: inv.investor_type, weighted: 0, committed: 0 };
      if (activeProductIds.has(pi.product_id)) {
        invAgg[pi.investor_id].weighted += (pi.target_ticket != null && pi.probability != null ? Number(pi.target_ticket) * Number(pi.probability) : 0);
      }
      if (Number(pi.committed_amount) > 0) {
        invAgg[pi.investor_id].committed += Number(pi.committed_amount);
      }
    });
    const { rows: invNames } = await query('SELECT id, name FROM investors WHERE deleted_at IS NULL');
    const nameMap = Object.fromEntries(invNames.map(i => [i.id, i.name]));
    const top30 = Object.values(invAgg)
      .map(i => ({ ...i, name: nameMap[i.id] || i.id, weighted: Math.round(i.weighted * 10) / 10, committed: Math.round(i.committed * 10) / 10 }))
      .filter(i => i.committed > 0)
      .sort((a, b) => b.committed - a.committed)
      .slice(0, 30);

    res.json({ fundStats, monthly: monthTotals, byResponsible, byPhase, byType, top30 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/aktivitetslogg', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT date::text AS date, log_type, responsible FROM contact_log WHERE date IS NOT NULL ORDER BY date`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/api/dashboard', async (req, res) => {
  try {
    const [{ rows: investors }, { rows: recent }, { rows: piRows }, { rows: productList }, { rows: piAllRows }] = await Promise.all([
      query('SELECT id, name, phase, investor_type, lead, last_contact, updated_at FROM investors WHERE deleted_at IS NULL'),
      query('SELECT * FROM contact_log ORDER BY date DESC, created_at DESC LIMIT 8'),
      query(`SELECT pi.investor_id, pi.target_ticket, pi.probability
             FROM product_investors pi
             WHERE pi.target_ticket IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM declined_offers d
               WHERE d.investor_id = pi.investor_id AND d.product_id = pi.product_id
             )`),
      query('SELECT * FROM products'),
      query('SELECT product_id, investor_id, committed_amount FROM product_investors'),
    ]);

    const total = investors.length;

    const ticket = piRows.reduce((s, pi) => s + (Number(pi.target_ticket) || 0), 0);
    const wgtd   = piRows.reduce((s, pi) =>
      s + (pi.target_ticket != null && pi.probability != null
        ? Number(pi.target_ticket) * Number(pi.probability) : 0), 0);

    const invPiMap = {};
    for (const pi of piRows) {
      if (!invPiMap[pi.investor_id]) invPiMap[pi.investor_id] = { ticket: 0, weighted: 0 };
      invPiMap[pi.investor_id].ticket += Number(pi.target_ticket) || 0;
      if (pi.probability != null)
        invPiMap[pi.investor_id].weighted += Number(pi.target_ticket) * Number(pi.probability);
    }

    const phaseMap = {};
    investors.forEach(i => {
      const p = i.phase || 'Ukjent';
      if (!phaseMap[p]) phaseMap[p] = { phase: p, count: 0, ticket: 0, weighted: 0 };
      phaseMap[p].count++;
      const pi = invPiMap[i.id] || {};
      phaseMap[p].ticket   += pi.ticket   || 0;
      phaseMap[p].weighted += pi.weighted || 0;
    });
    const byPhase = Object.values(phaseMap).sort((a, b) => b.count - a.count);

    const typeMap = {};
    investors.forEach(i => {
      const t = i.investor_type || 'Ukjent';
      if (!typeMap[t]) typeMap[t] = { investor_type: t, count: 0, ticket: 0 };
      typeMap[t].count++;
      typeMap[t].ticket += (invPiMap[i.id] || {}).ticket || 0;
    });
    const byType = Object.values(typeMap).sort((a, b) => b.count - a.count);

    const invsByProduct = {};
    const committedByProduct = {};
    piAllRows.forEach(pi => {
      if (!invsByProduct[pi.product_id]) invsByProduct[pi.product_id] = new Set();
      invsByProduct[pi.product_id].add(pi.investor_id);
      committedByProduct[pi.product_id] = (committedByProduct[pi.product_id] || 0) + (Number(pi.committed_amount) || 0);
    });
    const products = productList.map(p => ({
      _id: p.id, name: p.name, target_size: p.target_size || null,
      count:     (invsByProduct[p.id] || new Set()).size,
      committed: Math.round((committedByProduct[p.id] || 0) * 10) / 10,
      status:    p.status || null,
    }));

    const top10 = investors
      .map(i => ({
        ...fmtInvestor(i),
        target_ticket: (invPiMap[i.id] || {}).ticket  || null,
        weighted:      (invPiMap[i.id] || {}).weighted || null,
      }))
      .filter(i => i.weighted > 0)
      .sort((a, b) => b.weighted - a.weighted)
      .slice(0, 10);

    res.json({ total, ticket: Math.round(ticket * 10) / 10, weighted: Math.round(wgtd * 10) / 10, byPhase, byType, products, top10, recent: recent.map(fmtRow) });
  } catch (e) {
    console.error('[dashboard]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

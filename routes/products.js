const express = require('express');
const { query, pool } = require('../db');
const { fmtRow, validationError, requireAdmin, auditLog } = require('../lib/helpers');

const router = express.Router();

// ── Produkt-investorer ────────────────────────────────────────────────────────
router.get('/api/product-investors', async (req, res) => {
  const { investorId } = req.query;
  if (!investorId) return res.status(400).json({ error: 'investorId er påkrevd' });
  try {
    const { rows } = await query('SELECT * FROM product_investors WHERE investor_id = $1', [investorId]);
    res.json(rows);
  } catch (e) {
    console.error('[GET /product-investors]', e);
    res.status(500).json({ error: 'Kunne ikke hente produktinteresser' });
  }
});

router.put('/api/product-investors', async (req, res) => {
  const { product_id, investor_id, ...fields } = req.body;
  if (!product_id || !investor_id) return validationError(res, ['product_id og investor_id er påkrevd']);

  // Validate numeric fields only when explicitly sent and non-empty
  if ('target_ticket' in fields && fields.target_ticket != null && fields.target_ticket !== '') {
    const t = parseFloat(fields.target_ticket);
    if (isNaN(t) || t < 0) return validationError(res, ['Målticket må være et positivt tall']);
    fields.target_ticket = t;
  } else if ('target_ticket' in fields) { fields.target_ticket = null; }

  if ('probability' in fields && fields.probability != null && fields.probability !== '') {
    const p = parseFloat(fields.probability);
    if (isNaN(p) || p < 0 || p > 1) return validationError(res, ['Sannsynlighet må være mellom 0 og 1']);
    fields.probability = p;
  } else if ('probability' in fields) { fields.probability = null; }

  if ('committed_amount' in fields && fields.committed_amount != null && fields.committed_amount !== '') {
    const c = parseFloat(fields.committed_amount);
    if (isNaN(c) || c < 0) return validationError(res, ['Innbetalt beløp må være et positivt tall']);
    fields.committed_amount = c;
  } else if ('committed_amount' in fields) { fields.committed_amount = null; }

  // Only update fields that were explicitly sent — allows clearing to null
  const allowed = ['target_ticket', 'probability', 'decline_reason', 'committed_amount'];
  const sent = allowed.filter(f => f in fields);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Ensure row exists
    await client.query(
      'INSERT INTO product_investors (product_id, investor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [parseInt(product_id), investor_id]
    );
    // Update only the fields that were sent (null = explicit clear)
    if (sent.length > 0) {
      const setParts = sent.map((f, i) => `${f} = $${i + 3}`);
      await client.query(
        `UPDATE product_investors SET ${setParts.join(', ')} WHERE product_id=$1 AND investor_id=$2`,
        [parseInt(product_id), investor_id, ...sent.map(f => fields[f] ?? null)]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[PUT /product-investors]', e);
    res.status(500).json({ error: 'Kunne ikke oppdatere produktinteresse' });
  } finally {
    client.release();
  }
});

// ── Produkter ─────────────────────────────────────────────────────────────────
router.get('/api/products', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM products ORDER BY id');
    res.json(rows.map(r => ({ ...fmtRow(r) })));
  } catch (e) {
    console.error('[GET /products]', e);
    res.status(500).json({ error: 'Kunne ikke hente produkter' });
  }
});

router.post('/api/products', requireAdmin, async (req, res) => {
  if (!String(req.body.name || '').trim()) return validationError(res, ['Produktnavn er påkrevd']);
  try {
    const { rows: [p] } = await query(`
      INSERT INTO products (name, type, status, target_size, description, established_date)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [req.body.name, req.body.type || null, req.body.status || null,
        req.body.target_size || null, req.body.description || null, req.body.established_date || null]);
    res.json(fmtRow(p));
  } catch (e) {
    console.error('[POST /products]', e);
    res.status(500).json({ error: 'Kunne ikke opprette produkt' });
  }
});

router.put('/api/products/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  try {
    const { rows } = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const cur = rows[0];
    const b   = req.body;
    const v   = k => (k in b ? b[k] : cur[k]);
    const { rows: [p] } = await query(`
      UPDATE products SET name=$2, type=$3, status=$4, target_size=$5, description=$6, established_date=$7
      WHERE id=$1 RETURNING *
    `, [id, v('name'), v('type') || null, v('status') || null,
        v('target_size') || null, v('description') || null, v('established_date') || null]);
    res.json(fmtRow(p));
  } catch (e) {
    console.error('[PUT /products]', e);
    res.status(500).json({ error: 'Kunne ikke oppdatere produkt' });
  }
});

router.post('/api/products/:id/cancel', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  const reason = (req.body.reason || '').trim() || 'Prosjekt avlyst';
  const client = await pool.connect();
  try {
    const { rows: [product] } = await client.query('SELECT * FROM products WHERE id = $1', [id]);
    if (!product) return res.status(404).json({ error: 'Prosjekt ikke funnet' });

    const { rows: committed } = await client.query(
      'SELECT investor_id, committed_amount FROM product_investors WHERE product_id = $1 AND committed_amount > 0', [id]
    );

    await client.query('BEGIN');
    await client.query('UPDATE products SET status = $1 WHERE id = $2', ['Avlyst', id]);
    await client.query('UPDATE product_investors SET probability = 0 WHERE product_id = $1', [id]);

    for (const pi of committed) {
      await client.query(`
        INSERT INTO declined_offers (product_id, investor_id, decline_reason, declined_at)
        VALUES ($1,$2,$3,CURRENT_DATE)
        ON CONFLICT (product_id, investor_id) DO UPDATE
          SET decline_reason = EXCLUDED.decline_reason, declined_at = EXCLUDED.declined_at
      `, [id, pi.investor_id, reason]);
      await client.query(
        'UPDATE product_investors SET committed_amount = NULL WHERE product_id = $1 AND investor_id = $2',
        [id, pi.investor_id]
      );
    }

    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'cancel', 'product', id,
      { name: product.name, status: product.status },
      { status: 'Avlyst', committed_moved: committed.length },
      `Avlyste prosjekt: ${product.name} — ${committed.length} tegnet investor(er) flyttet til avslått`);
    res.json({ ok: true, committed_moved: committed.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /products/cancel]', e);
    res.status(500).json({ error: 'Kunne ikke avlyse prosjekt' });
  } finally {
    client.release();
  }
});

router.post('/api/products/:id/complete', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [product] } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!product) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Prosjekt ikke funnet' }); }
    await client.query('UPDATE products SET status = $1 WHERE id = $2', ['Fullført', id]);
    await client.query('COMMIT');
    await auditLog(req.currentUser._id, req.currentUser.username, 'complete', 'product', id,
      { name: product.name, status: product.status },
      { status: 'Fullført' },
      `Merket prosjekt som fullført: ${product.name}`);
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /products/complete]', e);
    res.status(500).json({ error: 'Kunne ikke fullføre prosjekt' });
  } finally {
    client.release();
  }
});

router.delete('/api/products/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  try {
    await query('DELETE FROM products WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /products]', e);
    res.status(500).json({ error: 'Kunne ikke slette produkt' });
  }
});

// ── Avslåtte tilbud ───────────────────────────────────────────────────────────
router.get('/api/declined-offers', async (req, res) => {
  const productId = parseInt(req.query.productId);
  if (!productId) return validationError(res, ['productId påkrevd']);
  try {
    const { rows } = await query(
      `SELECT d.id, d.product_id, d.investor_id, d.decline_reason, d.declined_at,
              i.name AS investor_name, i.lead, i.last_contact,
              pi.target_ticket
       FROM declined_offers d
       JOIN investors i ON i.id = d.investor_id
       LEFT JOIN product_investors pi ON pi.investor_id = d.investor_id AND pi.product_id = d.product_id
       WHERE d.product_id = $1
       ORDER BY d.declined_at DESC NULLS LAST, i.name`,
      [productId]
    );
    res.json(rows.map(fmtRow));
  } catch (e) {
    console.error('[GET /declined-offers]', e);
    res.status(500).json({ error: 'Kunne ikke hente avslåtte tilbud' });
  }
});

router.post('/api/declined-offers', async (req, res) => {
  const { product_id, investor_id, decline_reason, declined_at } = req.body;
  if (!product_id || !investor_id) return validationError(res, ['product_id og investor_id påkrevd']);
  try {
    const { rows } = await query(
      `INSERT INTO declined_offers (product_id, investor_id, decline_reason, declined_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, investor_id) DO UPDATE
         SET decline_reason = EXCLUDED.decline_reason,
             declined_at    = EXCLUDED.declined_at
       RETURNING *`,
      [product_id, investor_id, decline_reason || null, declined_at || null]
    );
    res.json(fmtRow(rows[0]));
  } catch (e) {
    console.error('[POST /declined-offers]', e);
    res.status(500).json({ error: 'Kunne ikke registrere avslag' });
  }
});

router.delete('/api/declined-offers/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ugyldig ID' });
  try {
    await query('DELETE FROM declined_offers WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /declined-offers]', e);
    res.status(500).json({ error: 'Kunne ikke slette avslag' });
  }
});

module.exports = router;

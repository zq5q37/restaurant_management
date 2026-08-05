const path = require('path');
const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadImage, removeQuietly, UPLOAD_DIR } = require('../middleware/upload');
const { decorate } = require('../menu/pricing');

const router = express.Router();

router.use(requireAuth);

const MANAGER_PLUS = requireRole('manager', 'admin');

// Matrix: "View unavailable items" is staff+. A customer must never see an item that is off.
const canSeeUnavailable = (user) => user.role !== 'customer';

const findRow = (id) => db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);

function respondWithItem(res, id, status = 200) {
  return res.status(status).json({ item: decorate(findRow(id)) });
}

const isPositiveInt = (v) => Number.isInteger(v) && v >= 0;

/** Shared validation for the money fields, used by both create and the pricing route. */
function validatePricing({ price_cents, special_price_cents, discount_percent }, { required }) {
  if (required || price_cents !== undefined) {
    if (!isPositiveInt(price_cents)) {
      return 'price_cents must be a non-negative integer (cents, not dollars)';
    }
  }
  if (special_price_cents != null && !isPositiveInt(special_price_cents)) {
    return 'special_price_cents must be a non-negative integer or null';
  }
  if (
    discount_percent != null &&
    (!Number.isInteger(discount_percent) || discount_percent < 1 || discount_percent > 99)
  ) {
    return 'discount_percent must be an integer between 1 and 99, or null';
  }
  if (special_price_cents != null && discount_percent != null) {
    return 'Set either special_price_cents or discount_percent, not both';
  }
  return null;
}

/* ---------------------------------------------------------------- read ---- */

/** GET /api/menu-items?q=&category_id=&available=&sort=&limit=&offset= */
router.get('/', (req, res) => {
  const { q, category_id, available, sort, limit, offset } = req.query;

  const where = [];
  const params = {};

  if (canSeeUnavailable(req.user)) {
    if (available === 'true') where.push('m.is_available = 1');
    if (available === 'false') where.push('m.is_available = 0');
  } else {
    // Not a filter the customer can opt out of.
    where.push('m.is_available = 1');
  }

  if (category_id !== undefined) {
    if (!/^\d+$/.test(category_id)) {
      return res.status(400).json({ error: 'category_id must be an integer' });
    }
    where.push('m.category_id = @category_id');
    params.category_id = Number(category_id);
  }

  if (q !== undefined && String(q).trim()) {
    // Escape LIKE wildcards so a search for "100%" doesn't match everything.
    const escaped = String(q).trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
    where.push("(m.name LIKE @q ESCAPE '\\' OR m.description LIKE @q ESCAPE '\\')");
    params.q = `%${escaped}%`;
  }

  const SORTS = {
    name: 'm.name',
    price: 'm.price_cents',
    newest: 'm.created_at DESC',
  };
  const orderBy = SORTS[sort] || 'c.display_order, c.name, m.name';

  const parsedLimit = Math.min(Number(limit) > 0 ? Number(limit) : 100, 200);
  const parsedOffset = Number(offset) > 0 ? Number(offset) : 0;

  const rows = db
    .prepare(`
      SELECT m.*, c.name AS category_name
      FROM menu_items m
      JOIN categories c ON c.id = m.category_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT @limit OFFSET @offset
    `)
    .all({ ...params, limit: parsedLimit, offset: parsedOffset });

  const { total } = db
    .prepare(`
      SELECT COUNT(*) AS total FROM menu_items m
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `)
    .get(params);

  res.json({ items: rows.map(decorate), total, limit: parsedLimit, offset: parsedOffset });
});

router.get('/:id', (req, res) => {
  const item = findRow(req.params.id);
  if (!item) return res.status(404).json({ error: 'Menu item not found' });

  // Hide unavailable items from customers rather than returning them as 200.
  if (!item.is_available && !canSeeUnavailable(req.user)) {
    return res.status(404).json({ error: 'Menu item not found' });
  }

  res.json({ item: decorate(item) });
});

/* -------------------------------------------------------------- write ---- */

router.post('/', MANAGER_PLUS, (req, res) => {
  const { category_id, name, description, price_cents, is_available } = req.body || {};

  if (!Number.isInteger(category_id)) {
    return res.status(400).json({ error: 'category_id is required' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const pricingError = validatePricing(req.body || {}, { required: true });
  if (pricingError) return res.status(400).json({ error: pricingError });

  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) {
    return res.status(400).json({ error: 'category_id does not exist' });
  }
  const clash = db.prepare('SELECT 1 FROM menu_items WHERE category_id = ? AND name = ?')
    .get(category_id, name.trim());
  if (clash) {
    return res.status(409).json({ error: 'That category already has an item with this name' });
  }

  const info = db
    .prepare(`
      INSERT INTO menu_items (category_id, name, description, price_cents, is_available)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(category_id, name.trim(), description ?? null, price_cents, is_available === false ? 0 : 1);

  respondWithItem(res, info.lastInsertRowid, 201);
});

router.patch('/:id', MANAGER_PLUS, (req, res) => {
  const item = findRow(req.params.id);
  if (!item) return res.status(404).json({ error: 'Menu item not found' });

  const { category_id, name, description } = req.body || {};
  const updates = {};

  if (category_id !== undefined) {
    if (!Number.isInteger(category_id)) {
      return res.status(400).json({ error: 'category_id must be an integer' });
    }
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) {
      return res.status(400).json({ error: 'category_id does not exist' });
    }
    updates.category_id = category_id;
  }
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    updates.name = name.trim();
  }
  if (description !== undefined) updates.description = description;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Provide category_id, name and/or description' });
  }

  const targetCategory = updates.category_id ?? item.category_id;
  const targetName = updates.name ?? item.name;
  const clash = db.prepare('SELECT 1 FROM menu_items WHERE category_id = ? AND name = ? AND id != ?')
    .get(targetCategory, targetName, item.id);
  if (clash) {
    return res.status(409).json({ error: 'That category already has an item with this name' });
  }

  const assignments = Object.keys(updates).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE menu_items SET ${assignments}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...updates, id: item.id });

  respondWithItem(res, item.id);
});

router.delete('/:id', MANAGER_PLUS, (req, res) => {
  const item = findRow(req.params.id);
  if (!item) return res.status(404).json({ error: 'Menu item not found' });

  db.prepare('DELETE FROM menu_items WHERE id = ?').run(item.id);
  if (item.image_path) removeQuietly(path.join(UPLOAD_DIR, item.image_path));

  res.status(204).end();
});

/* ------------------------------------------------------- availability ---- */

router.patch('/:id/availability', MANAGER_PLUS, (req, res) => {
  const item = findRow(req.params.id);
  if (!item) return res.status(404).json({ error: 'Menu item not found' });

  const { is_available } = req.body || {};
  if (typeof is_available !== 'boolean') {
    return res.status(400).json({ error: 'is_available must be true or false' });
  }

  db.prepare("UPDATE menu_items SET is_available = ?, updated_at = datetime('now') WHERE id = ?")
    .run(is_available ? 1 : 0, item.id);

  respondWithItem(res, item.id);
});

/* ------------------------------------------------------------ pricing ---- */

router.patch('/:id/pricing', MANAGER_PLUS, (req, res) => {
  const item = findRow(req.params.id);
  if (!item) return res.status(404).json({ error: 'Menu item not found' });

  const body = req.body || {};
  const FIELDS = [
    'price_cents',
    'special_price_cents',
    'discount_percent',
    'special_starts_at',
    'special_ends_at',
  ];
  const provided = FIELDS.filter((f) => body[f] !== undefined);
  if (!provided.length) {
    return res.status(400).json({ error: `Provide at least one of: ${FIELDS.join(', ')}` });
  }

  // Validate against the row as it will be *after* the patch, not just the fields sent, so
  // setting a discount on an item that already has a special price is still rejected.
  const merged = { ...item };
  for (const f of provided) merged[f] = body[f];

  const pricingError = validatePricing(merged, { required: false });
  if (pricingError) return res.status(400).json({ error: pricingError });

  if (
    merged.special_starts_at &&
    merged.special_ends_at &&
    merged.special_ends_at < merged.special_starts_at
  ) {
    return res.status(400).json({ error: 'special_ends_at must be after special_starts_at' });
  }
  if (merged.special_price_cents != null && merged.special_price_cents > merged.price_cents) {
    return res.status(400).json({ error: 'special_price_cents must not exceed price_cents' });
  }

  const assignments = provided.map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE menu_items SET ${assignments}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...Object.fromEntries(provided.map((f) => [f, body[f]])), id: item.id });

  respondWithItem(res, item.id);
});

/* -------------------------------------------------------------- image ---- */

router.post('/:id/image', MANAGER_PLUS, (req, res, next) => {
  // Check the item exists before multer writes anything to disk.
  if (!findRow(req.params.id)) return res.status(404).json({ error: 'Menu item not found' });
  next();
}, uploadImage('image'), (req, res) => {
  const item = findRow(req.params.id);
  const previous = item.image_path;

  db.prepare("UPDATE menu_items SET image_path = ?, updated_at = datetime('now') WHERE id = ?")
    .run(req.file.filename, item.id);

  if (previous) removeQuietly(path.join(UPLOAD_DIR, previous));

  respondWithItem(res, item.id);
});

router.delete('/:id/image', MANAGER_PLUS, (req, res) => {
  const item = findRow(req.params.id);
  if (!item) return res.status(404).json({ error: 'Menu item not found' });
  if (!item.image_path) return res.status(404).json({ error: 'Item has no image' });

  db.prepare("UPDATE menu_items SET image_path = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(item.id);
  removeQuietly(path.join(UPLOAD_DIR, item.image_path));

  res.status(204).end();
});

module.exports = router;

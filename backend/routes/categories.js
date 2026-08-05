const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Matrix: "Manage categories" is manager+. Viewing is open to every signed-in role,
// since every role can view the menu.
router.use(requireAuth);

const MANAGER_PLUS = requireRole('manager', 'admin');

const findById = (id) => db.prepare('SELECT * FROM categories WHERE id = ?').get(id);

router.get('/', (req, res) => {
  const categories = db
    .prepare(`
      SELECT c.*, COUNT(m.id) AS item_count
      FROM categories c
      LEFT JOIN menu_items m ON m.category_id = c.id
      GROUP BY c.id
      ORDER BY c.display_order, c.name
    `)
    .all();

  res.json({ categories });
});

router.post('/', MANAGER_PLUS, (req, res) => {
  const { name, description, display_order } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (display_order !== undefined && !Number.isInteger(display_order)) {
    return res.status(400).json({ error: 'display_order must be an integer' });
  }
  if (db.prepare('SELECT 1 FROM categories WHERE name = ?').get(name.trim())) {
    return res.status(409).json({ error: 'A category with that name already exists' });
  }

  const info = db
    .prepare('INSERT INTO categories (name, description, display_order) VALUES (?, ?, ?)')
    .run(name.trim(), description ?? null, display_order ?? 0);

  res.status(201).json({ category: findById(info.lastInsertRowid) });
});

router.patch('/:id', MANAGER_PLUS, (req, res) => {
  const category = findById(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  const { name, description, display_order } = req.body || {};
  const updates = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    const clash = db.prepare('SELECT 1 FROM categories WHERE name = ? AND id != ?')
      .get(name.trim(), category.id);
    if (clash) return res.status(409).json({ error: 'A category with that name already exists' });
    updates.name = name.trim();
  }
  if (description !== undefined) updates.description = description;
  if (display_order !== undefined) {
    if (!Number.isInteger(display_order)) {
      return res.status(400).json({ error: 'display_order must be an integer' });
    }
    updates.display_order = display_order;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Provide name, description and/or display_order' });
  }

  const assignments = Object.keys(updates).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE categories SET ${assignments}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...updates, id: category.id });

  res.json({ category: findById(category.id) });
});

router.delete('/:id', MANAGER_PLUS, (req, res) => {
  const category = findById(req.params.id);
  if (!category) return res.status(404).json({ error: 'Category not found' });

  // ON DELETE RESTRICT would throw a raw SQLite error; checking first gives a usable message.
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE category_id = ?')
    .get(category.id);
  if (count > 0) {
    return res.status(409).json({
      error: `Category still has ${count} menu item(s). Move or delete them first.`,
    });
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(category.id);
  res.status(204).end();
});

module.exports = router;

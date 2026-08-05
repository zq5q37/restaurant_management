const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isTimeString } = require('../schedule/dates');
const { SHIFT_ROLES } = require('../schedule/store');

const router = express.Router();

// Matrix: "Create / edit / delete shift" is manager+, and templates define shifts.
router.use(requireAuth, requireRole('manager', 'admin'));

const findById = (id) => db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(id);

/** Shared field validation. Returns an error string, or null when the input is good. */
function validate({ day_of_week, start_time, end_time, role, required_staff }, { required }) {
  if (required || day_of_week !== undefined) {
    if (!Number.isInteger(day_of_week) || day_of_week < 1 || day_of_week > 7) {
      return 'day_of_week must be an integer 1 (Monday) to 7 (Sunday)';
    }
  }
  if (required || start_time !== undefined) {
    if (!isTimeString(start_time)) return 'start_time must be HH:MM in 24-hour form';
  }
  if (required || end_time !== undefined) {
    if (!isTimeString(end_time)) return 'end_time must be HH:MM in 24-hour form';
  }
  if (required || role !== undefined) {
    if (!SHIFT_ROLES.includes(role)) return `role must be one of: ${SHIFT_ROLES.join(', ')}`;
  }
  if (required_staff !== undefined) {
    if (!Number.isInteger(required_staff) || required_staff < 1) {
      return 'required_staff must be an integer of at least 1';
    }
  }
  if (start_time !== undefined && end_time !== undefined && start_time === end_time) {
    return 'start_time and end_time cannot be identical';
  }
  return null;
}

router.get('/', (req, res) => {
  const templates = db
    .prepare('SELECT * FROM shift_templates ORDER BY day_of_week, start_time, role')
    .all();
  res.json({ templates });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const error = validate(body, { required: true });
  if (error) return res.status(400).json({ error });

  const { day_of_week, start_time, end_time, role, required_staff } = body;

  const clash = db
    .prepare(`
      SELECT 1 FROM shift_templates
      WHERE day_of_week = ? AND start_time = ? AND end_time = ? AND role = ?
    `)
    .get(day_of_week, start_time, end_time, role);
  if (clash) {
    return res.status(409).json({ error: 'An identical template already exists' });
  }

  const info = db
    .prepare(`
      INSERT INTO shift_templates (day_of_week, start_time, end_time, role, required_staff)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(day_of_week, start_time, end_time, role, required_staff ?? 1);

  res.status(201).json({ template: findById(info.lastInsertRowid) });
});

router.patch('/:id', (req, res) => {
  const template = findById(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const body = req.body || {};
  const FIELDS = ['day_of_week', 'start_time', 'end_time', 'role', 'required_staff', 'is_active'];
  const provided = FIELDS.filter((f) => body[f] !== undefined);
  if (!provided.length) {
    return res.status(400).json({ error: `Provide at least one of: ${FIELDS.join(', ')}` });
  }

  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be true or false' });
  }

  // Validate the merged row so a partial patch cannot produce an invalid combination.
  const merged = { ...template, ...body };
  const error = validate(merged, { required: false });
  if (error) return res.status(400).json({ error });

  const values = Object.fromEntries(
    provided.map((f) => [f, f === 'is_active' ? (body[f] ? 1 : 0) : body[f]])
  );
  const assignments = provided.map((f) => `${f} = @${f}`).join(', ');

  db.prepare(`UPDATE shift_templates SET ${assignments}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...values, id: template.id });

  res.json({ template: findById(template.id) });
});

router.delete('/:id', (req, res) => {
  const template = findById(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  // Shifts already generated survive: the FK is ON DELETE SET NULL, so history is preserved
  // and only the link to the recurring rule is dropped.
  db.prepare('DELETE FROM shift_templates WHERE id = ?').run(template.id);
  res.status(204).end();
});

module.exports = router;

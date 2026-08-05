const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isTimeString } = require('../schedule/dates');

const router = express.Router();

router.use(requireAuth);

const canManageOthers = (user) => user.role === 'manager' || user.role === 'admin';

/**
 * Matrix: staff set their *own* availability; manager+ may set anyone's.
 *
 * Unlike /api/profile, the resource here carries a user_id, so ownership has to be an explicit
 * comparison rather than something the URL shape guarantees. Everything below resolves the
 * target through this one function so the rule lives in a single place.
 */
function resolveTarget(req, res, requested) {
  if (requested === undefined || requested === null) return req.user.id;

  const targetId = Number(requested);
  if (!Number.isInteger(targetId)) {
    res.status(400).json({ error: 'user_id must be an integer' });
    return null;
  }
  if (targetId !== req.user.id && !canManageOthers(req.user)) {
    res.status(403).json({ error: "You may only manage your own availability" });
    return null;
  }
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(targetId)) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return targetId;
}

router.get('/', (req, res) => {
  const targetId = resolveTarget(req, res, req.query.user_id);
  if (targetId === null) return;

  const availability = db
    .prepare(`
      SELECT * FROM staff_availability
      WHERE user_id = ?
      ORDER BY day_of_week, start_time
    `)
    .all(targetId);

  res.json({ user_id: targetId, availability });
});

router.post('/', (req, res) => {
  const { day_of_week, start_time, end_time, user_id } = req.body || {};

  const targetId = resolveTarget(req, res, user_id);
  if (targetId === null) return;

  if (!Number.isInteger(day_of_week) || day_of_week < 1 || day_of_week > 7) {
    return res.status(400).json({ error: 'day_of_week must be an integer 1 (Monday) to 7 (Sunday)' });
  }
  if (!isTimeString(start_time) || !isTimeString(end_time)) {
    return res.status(400).json({ error: 'start_time and end_time must be HH:MM in 24-hour form' });
  }
  if (end_time <= start_time) {
    // Availability is a window within one day, so unlike a shift it cannot wrap past midnight.
    return res.status(400).json({ error: 'end_time must be after start_time' });
  }

  const clash = db
    .prepare(`
      SELECT 1 FROM staff_availability
      WHERE user_id = ? AND day_of_week = ? AND start_time = ? AND end_time = ?
    `)
    .get(targetId, day_of_week, start_time, end_time);
  if (clash) {
    return res.status(409).json({ error: 'That availability window already exists' });
  }

  const info = db
    .prepare(`
      INSERT INTO staff_availability (user_id, day_of_week, start_time, end_time)
      VALUES (?, ?, ?, ?)
    `)
    .run(targetId, day_of_week, start_time, end_time);

  res.status(201).json({
    availability: db.prepare('SELECT * FROM staff_availability WHERE id = ?').get(info.lastInsertRowid),
  });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM staff_availability WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Availability window not found' });

  if (row.user_id !== req.user.id && !canManageOthers(req.user)) {
    return res.status(403).json({ error: "You may only manage your own availability" });
  }

  db.prepare('DELETE FROM staff_availability WHERE id = ?').run(row.id);
  res.status(204).end();
});

module.exports = router;

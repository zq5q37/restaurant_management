const { db } = require('../db');

const SHIFT_ROLES = ['server', 'host', 'cleaner', 'cook', 'bartender'];

/**
 * Any shift this user is already on that overlaps [starts_at, ends_at).
 *
 * Two intervals overlap when each starts before the other ends. Because both bounds are
 * absolute timestamps, this holds for shifts that cross midnight without special-casing.
 * Touching shifts (one ends exactly as the next begins) are not a conflict.
 */
function findConflict(userId, startsAt, endsAt, exceptShiftId = null) {
  return db
    .prepare(`
      SELECT s.id, s.shift_date, s.starts_at, s.ends_at, s.role
      FROM shift_assignments a
      JOIN shifts s ON s.id = a.shift_id
      WHERE a.user_id = ?
        AND (? IS NULL OR s.id != ?)
        AND s.starts_at < ?
        AND ? < s.ends_at
      LIMIT 1
    `)
    .get(userId, exceptShiftId, exceptShiftId, endsAt, startsAt);
}

const insertNotification = db.prepare(`
  INSERT INTO notifications (user_id, kind, message, shift_id)
  VALUES (@user_id, @kind, @message, @shift_id)
`);

/** Simulated notification: a row the recipient can read back from /api/notifications. */
function notify(userId, kind, message, shiftId = null) {
  insertNotification.run({ user_id: userId, kind, message, shift_id: shiftId });
}

/** Notify everyone currently assigned to a shift — used when one is edited or deleted. */
function notifyAssignees(shiftId, kind, message) {
  const rows = db
    .prepare('SELECT user_id FROM shift_assignments WHERE shift_id = ?')
    .all(shiftId);

  for (const { user_id } of rows) {
    // shift_id is deliberately omitted for deletions: the row is about to disappear and the
    // FK would null it out anyway, taking the context with it.
    notify(user_id, kind, message, kind === 'shift_deleted' ? null : shiftId);
  }
  return rows.length;
}

/** A shift with its assignees attached, shaped for the API. */
function shiftWithAssignments(shiftId) {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) return null;

  const assignments = db
    .prepare(`
      SELECT a.user_id, u.full_name, u.email, a.created_at
      FROM shift_assignments a
      JOIN users u ON u.id = a.user_id
      WHERE a.shift_id = ?
      ORDER BY u.full_name
    `)
    .all(shiftId);

  return {
    ...shift,
    assignments,
    assigned_count: assignments.length,
    is_covered: assignments.length >= shift.required_staff,
  };
}

module.exports = { SHIFT_ROLES, findConflict, notify, notifyAssignees, shiftWithAssignments };

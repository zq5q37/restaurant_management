const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isDateString, isTimeString, shiftBounds, weekStart, addDays } = require('../schedule/dates');
const {
  SHIFT_ROLES,
  findConflict,
  notify,
  notifyAssignees,
  shiftWithAssignments,
} = require('../schedule/store');

const router = express.Router();

router.use(requireAuth);

const MANAGER_PLUS = requireRole('manager', 'admin');
const canSeeEveryone = (user) => user.role === 'manager' || user.role === 'admin';

const findRow = (id) => db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);

const timeOf = (stamp) => stamp.slice(11, 16);

/* ---------------------------------------------------------------- read ---- */

/**
 * GET /api/shifts?week_start=&from=&to=&role=&user_id=
 *
 * Matrix: staff may view their *own* schedule only, so their results are restricted to shifts
 * they are assigned to. Manager+ see everything and may filter by user_id.
 */
router.get('/', (req, res) => {
  const { week_start, from, to, role, user_id } = req.query;

  let start = from;
  let end = to;

  if (week_start !== undefined) {
    if (!isDateString(week_start)) {
      return res.status(400).json({ error: 'week_start must be YYYY-MM-DD' });
    }
    start = weekStart(week_start);
    end = addDays(start, 6);
  }

  if (start !== undefined && !isDateString(start)) {
    return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  }
  if (end !== undefined && !isDateString(end)) {
    return res.status(400).json({ error: 'to must be YYYY-MM-DD' });
  }
  if (role !== undefined && !SHIFT_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${SHIFT_ROLES.join(', ')}` });
  }

  const where = [];
  const params = {};

  if (start) {
    where.push('s.shift_date >= @start');
    params.start = start;
  }
  if (end) {
    where.push('s.shift_date <= @end');
    params.end = end;
  }
  if (role) {
    where.push('s.role = @role');
    params.role = role;
  }

  if (canSeeEveryone(req.user)) {
    if (user_id !== undefined) {
      if (!/^\d+$/.test(user_id)) {
        return res.status(400).json({ error: 'user_id must be an integer' });
      }
      where.push('EXISTS (SELECT 1 FROM shift_assignments a WHERE a.shift_id = s.id AND a.user_id = @user_id)');
      params.user_id = Number(user_id);
    }
  } else {
    // Not a filter staff can turn off.
    where.push('EXISTS (SELECT 1 FROM shift_assignments a WHERE a.shift_id = s.id AND a.user_id = @self)');
    params.self = req.user.id;
  }

  const rows = db
    .prepare(`
      SELECT s.id FROM shifts s
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.starts_at, s.role
    `)
    .all(params);

  res.json({
    shifts: rows.map((r) => shiftWithAssignments(r.id)),
    scope: canSeeEveryone(req.user) ? 'all' : 'own',
  });
});

router.get('/:id', (req, res) => {
  const shift = shiftWithAssignments(req.params.id);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  if (!canSeeEveryone(req.user) && !shift.assignments.some((a) => a.user_id === req.user.id)) {
    return res.status(404).json({ error: 'Shift not found' });
  }

  res.json({ shift });
});

/* --------------------------------------------------------------- write ---- */

router.post('/', MANAGER_PLUS, (req, res) => {
  const { shift_date, start_time, end_time, role, required_staff, notes } = req.body || {};

  if (!isDateString(shift_date)) {
    return res.status(400).json({ error: 'shift_date must be YYYY-MM-DD' });
  }
  if (!isTimeString(start_time) || !isTimeString(end_time)) {
    return res.status(400).json({ error: 'start_time and end_time must be HH:MM in 24-hour form' });
  }
  if (start_time === end_time) {
    return res.status(400).json({ error: 'start_time and end_time cannot be identical' });
  }
  if (!SHIFT_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${SHIFT_ROLES.join(', ')}` });
  }
  if (required_staff !== undefined && (!Number.isInteger(required_staff) || required_staff < 1)) {
    return res.status(400).json({ error: 'required_staff must be an integer of at least 1' });
  }

  const { starts_at, ends_at } = shiftBounds(shift_date, start_time, end_time);

  const info = db
    .prepare(`
      INSERT INTO shifts (shift_date, starts_at, ends_at, role, required_staff, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(shift_date, starts_at, ends_at, role, required_staff ?? 1, notes ?? null);

  res.status(201).json({ shift: shiftWithAssignments(info.lastInsertRowid) });
});

router.patch('/:id', MANAGER_PLUS, (req, res) => {
  const shift = findRow(req.params.id);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  const body = req.body || {};
  const FIELDS = ['shift_date', 'start_time', 'end_time', 'role', 'required_staff', 'notes'];
  if (!FIELDS.some((f) => body[f] !== undefined)) {
    return res.status(400).json({ error: `Provide at least one of: ${FIELDS.join(', ')}` });
  }

  const shift_date = body.shift_date ?? shift.shift_date;
  const start_time = body.start_time ?? timeOf(shift.starts_at);
  const end_time = body.end_time ?? timeOf(shift.ends_at);
  const role = body.role ?? shift.role;
  const required_staff = body.required_staff ?? shift.required_staff;

  if (!isDateString(shift_date)) {
    return res.status(400).json({ error: 'shift_date must be YYYY-MM-DD' });
  }
  if (!isTimeString(start_time) || !isTimeString(end_time)) {
    return res.status(400).json({ error: 'start_time and end_time must be HH:MM in 24-hour form' });
  }
  if (start_time === end_time) {
    return res.status(400).json({ error: 'start_time and end_time cannot be identical' });
  }
  if (!SHIFT_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${SHIFT_ROLES.join(', ')}` });
  }
  if (!Number.isInteger(required_staff) || required_staff < 1) {
    return res.status(400).json({ error: 'required_staff must be an integer of at least 1' });
  }

  const { starts_at, ends_at } = shiftBounds(shift_date, start_time, end_time);

  // Moving a shift can push an assignee into a clash with another of their shifts.
  const movedInTime = starts_at !== shift.starts_at || ends_at !== shift.ends_at;
  if (movedInTime) {
    const assignees = db
      .prepare('SELECT user_id FROM shift_assignments WHERE shift_id = ?')
      .all(shift.id);

    for (const { user_id } of assignees) {
      const conflict = findConflict(user_id, starts_at, ends_at, shift.id);
      if (conflict) {
        const who = db.prepare('SELECT full_name FROM users WHERE id = ?').get(user_id);
        return res.status(409).json({
          error: `${who.full_name} is already assigned to an overlapping shift on ${conflict.shift_date} (${conflict.starts_at} to ${conflict.ends_at})`,
        });
      }
    }
  }

  db.prepare(`
    UPDATE shifts
    SET shift_date = ?, starts_at = ?, ends_at = ?, role = ?, required_staff = ?, notes = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    shift_date,
    starts_at,
    ends_at,
    role,
    required_staff,
    body.notes !== undefined ? body.notes : shift.notes,
    shift.id
  );

  notifyAssignees(
    shift.id,
    'shift_updated',
    `Your ${role} shift changed: ${starts_at} to ${ends_at}`
  );

  res.json({ shift: shiftWithAssignments(shift.id) });
});

router.delete('/:id', MANAGER_PLUS, (req, res) => {
  const shift = findRow(req.params.id);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  // Notify before deleting: ON DELETE CASCADE removes the assignment rows we read here.
  notifyAssignees(
    shift.id,
    'shift_deleted',
    `Your ${shift.role} shift on ${shift.shift_date} (${shift.starts_at} to ${shift.ends_at}) was cancelled`
  );

  db.prepare('DELETE FROM shifts WHERE id = ?').run(shift.id);
  res.status(204).end();
});

/* ---------------------------------------------------------- assignments ---- */

router.post('/:id/assignments', MANAGER_PLUS, (req, res) => {
  const shift = findRow(req.params.id);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  const { user_id } = req.body || {};
  if (!Number.isInteger(user_id)) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const user = db.prepare('SELECT id, full_name, role, is_active FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.is_active) {
    return res.status(409).json({ error: 'Cannot assign a deactivated user' });
  }
  if (user.role === 'customer') {
    return res.status(409).json({ error: 'Customers cannot be assigned to shifts' });
  }

  const already = db
    .prepare('SELECT 1 FROM shift_assignments WHERE shift_id = ? AND user_id = ?')
    .get(shift.id, user.id);
  if (already) {
    return res.status(409).json({ error: `${user.full_name} is already assigned to this shift` });
  }

  const conflict = findConflict(user.id, shift.starts_at, shift.ends_at, shift.id);
  if (conflict) {
    return res.status(409).json({
      error: `${user.full_name} is already assigned to an overlapping shift on ${conflict.shift_date} (${conflict.starts_at} to ${conflict.ends_at})`,
      conflicting_shift_id: conflict.id,
    });
  }

  db.prepare('INSERT INTO shift_assignments (shift_id, user_id, assigned_by) VALUES (?, ?, ?)')
    .run(shift.id, user.id, req.user.id);

  notify(
    user.id,
    'shift_assigned',
    `You were assigned a ${shift.role} shift on ${shift.shift_date} (${shift.starts_at} to ${shift.ends_at})`,
    shift.id
  );

  res.status(201).json({ shift: shiftWithAssignments(shift.id) });
});

router.delete('/:id/assignments/:userId', MANAGER_PLUS, (req, res) => {
  const shift = findRow(req.params.id);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  const info = db
    .prepare('DELETE FROM shift_assignments WHERE shift_id = ? AND user_id = ?')
    .run(shift.id, req.params.userId);

  if (info.changes === 0) {
    return res.status(404).json({ error: 'That user is not assigned to this shift' });
  }

  notify(
    Number(req.params.userId),
    'shift_unassigned',
    `You were removed from the ${shift.role} shift on ${shift.shift_date}`,
    shift.id
  );

  res.json({ shift: shiftWithAssignments(shift.id) });
});

module.exports = router;

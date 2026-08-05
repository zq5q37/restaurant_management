const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isDateString, weekStart, weekDates, addDays, shiftBounds, isoDayOfWeek } = require('../schedule/dates');
const { shiftWithAssignments, notify } = require('../schedule/store');

const router = express.Router();

router.use(requireAuth);

const MANAGER_PLUS = requireRole('manager', 'admin');
const canSeeEveryone = (user) => user.role === 'manager' || user.role === 'admin';

/** Resolves ?week_start= to the Monday of that week, defaulting to the current week. */
function resolveWeek(req, res) {
  const raw = req.query.week_start ?? new Date().toISOString().slice(0, 10);
  if (!isDateString(raw)) {
    res.status(400).json({ error: 'week_start must be YYYY-MM-DD' });
    return null;
  }
  return weekStart(raw);
}

/**
 * POST /api/schedule/generate { week_start }
 *
 * Creates one concrete shift per active template for the given week. Idempotent: the
 * UNIQUE (template_id, shift_date) constraint means re-running adds only what is missing,
 * so a manager can add a template mid-week and generate again without duplicating.
 */
router.post('/generate', MANAGER_PLUS, (req, res) => {
  const { week_start } = req.body || {};
  if (!isDateString(week_start)) {
    return res.status(400).json({ error: 'week_start must be YYYY-MM-DD' });
  }

  const monday = weekStart(week_start);
  const dates = weekDates(monday);
  const templates = db.prepare('SELECT * FROM shift_templates WHERE is_active = 1').all();

  const insert = db.prepare(`
    INSERT INTO shifts (template_id, shift_date, starts_at, ends_at, role, required_staff)
    VALUES (@template_id, @shift_date, @starts_at, @ends_at, @role, @required_staff)
    ON CONFLICT (template_id, shift_date) DO NOTHING
  `);

  const generate = db.transaction(() => {
    let created = 0;
    for (const template of templates) {
      const shift_date = dates[template.day_of_week - 1];
      const { starts_at, ends_at } = shiftBounds(shift_date, template.start_time, template.end_time);

      const changes = insert.run({
        template_id: template.id,
        shift_date,
        starts_at,
        ends_at,
        role: template.role,
        required_staff: template.required_staff,
      }).changes;

      created += changes;
    }
    return created;
  });

  const created = generate();

  res.status(created > 0 ? 201 : 200).json({
    week_start: monday,
    week_end: addDays(monday, 6),
    templates_considered: templates.length,
    shifts_created: created,
    shifts_skipped: templates.length - created,
  });
});

/**
 * GET /api/schedule/week?week_start=
 * The weekly overview: seven days, each with its shifts and who is on them.
 */
router.get('/week', (req, res) => {
  const monday = resolveWeek(req, res);
  if (!monday) return;

  const sunday = addDays(monday, 6);
  const mine = !canSeeEveryone(req.user);

  const rows = db
    .prepare(`
      SELECT s.id FROM shifts s
      WHERE s.shift_date BETWEEN ? AND ?
        AND (? = 0 OR EXISTS (
          SELECT 1 FROM shift_assignments a WHERE a.shift_id = s.id AND a.user_id = ?
        ))
      ORDER BY s.starts_at, s.role
    `)
    .all(monday, sunday, mine ? 1 : 0, req.user.id);

  const shifts = rows.map((r) => shiftWithAssignments(r.id));

  const days = weekDates(monday).map((date) => ({
    date,
    day_of_week: isoDayOfWeek(date),
    shifts: shifts.filter((s) => s.shift_date === date),
  }));

  res.json({
    week_start: monday,
    week_end: sunday,
    scope: mine ? 'own' : 'all',
    days,
  });
});

/**
 * GET /api/schedule/coverage?week_start=
 * Matrix: "View coverage gaps" is manager+.
 */
router.get('/coverage', MANAGER_PLUS, (req, res) => {
  const monday = resolveWeek(req, res);
  if (!monday) return;

  const sunday = addDays(monday, 6);

  const rows = db
    .prepare(`
      SELECT s.*, COUNT(a.id) AS assigned_count
      FROM shifts s
      LEFT JOIN shift_assignments a ON a.shift_id = s.id
      WHERE s.shift_date BETWEEN ? AND ?
      GROUP BY s.id
      ORDER BY s.starts_at, s.role
    `)
    .all(monday, sunday);

  const shifts = rows.map((s) => ({
    ...s,
    is_covered: s.assigned_count >= s.required_staff,
    missing: Math.max(0, s.required_staff - s.assigned_count),
  }));

  const gaps = shifts.filter((s) => !s.is_covered);

  res.json({
    week_start: monday,
    week_end: sunday,
    total_shifts: shifts.length,
    covered_shifts: shifts.length - gaps.length,
    uncovered_shifts: gaps.length,
    staff_needed: gaps.reduce((sum, s) => sum + s.missing, 0),
    gaps,
  });
});

/**
 * POST /api/schedule/publish { week_start }
 * Simulated notification fan-out: tells everyone working that week that it is final.
 */
router.post('/publish', MANAGER_PLUS, (req, res) => {
  const { week_start } = req.body || {};
  if (!isDateString(week_start)) {
    return res.status(400).json({ error: 'week_start must be YYYY-MM-DD' });
  }

  const monday = weekStart(week_start);
  const sunday = addDays(monday, 6);

  const recipients = db
    .prepare(`
      SELECT DISTINCT a.user_id
      FROM shift_assignments a
      JOIN shifts s ON s.id = a.shift_id
      WHERE s.shift_date BETWEEN ? AND ?
    `)
    .all(monday, sunday);

  const publish = db.transaction(() => {
    for (const { user_id } of recipients) {
      notify(user_id, 'schedule_published', `The schedule for week of ${monday} has been published`);
    }
  });
  publish();

  res.json({ week_start: monday, week_end: sunday, notified: recipients.length });
});

module.exports = router;

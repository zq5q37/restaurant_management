const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Notifications are always the caller's own. Like /api/profile there is no id in the URL for
// the owner, so no ownership comparison is needed on read; the id routes below check it.

router.get('/', (req, res) => {
  const unreadOnly = req.query.unread === 'true';

  const notifications = db
    .prepare(`
      SELECT * FROM notifications
      WHERE user_id = @user_id ${unreadOnly ? 'AND is_read = 0' : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `)
    .all({ user_id: req.user.id });

  const { unread } = db
    .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id);

  res.json({ notifications, unread });
});

router.patch('/:id/read', (req, res) => {
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);

  // Same 404 whether it does not exist or belongs to someone else — a different response
  // would confirm the existence of other people's notifications.
  if (!row || row.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(row.id);
  res.json({ notification: db.prepare('SELECT * FROM notifications WHERE id = ?').get(row.id) });
});

router.post('/read-all', (req, res) => {
  const info = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
    .run(req.user.id);

  res.json({ marked_read: info.changes });
});

module.exports = router;

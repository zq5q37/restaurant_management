const { db } = require('../db');

const insertActivity = db.prepare(`
  INSERT INTO activity_log (user_id, method, path, status, duration_ms)
  VALUES (@user_id, @method, @path, @status, @duration_ms)
`);

// Health checks are polled by Docker and would swamp every "top endpoints" list with noise.
// Image requests are unauthenticated asset fetches, not user activity.
const IGNORED = [/^\/api\/health$/, /^\/api\/images(\/|$)/];

/**
 * Records one row per API request for the system usage report.
 *
 * The write happens on the response's 'finish' event, which fires after the last byte is
 * sent, so this synchronous insert is off the response path and cannot slow a request down.
 * A logging failure is swallowed: telemetry must never turn a working request into a 500.
 */
function logActivity(req, res, next) {
  if (IGNORED.some((pattern) => pattern.test(req.path))) return next();

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000n) / 1000;

    try {
      insertActivity.run({
        // req.route is only populated once a route has matched; a 404 falls back to the
        // raw path, which is the useful thing to see for an endpoint that does not exist.
        path: req.route ? `${req.baseUrl}${req.route.path}` : req.originalUrl.split('?')[0],
        method: req.method,
        // requireAuth sets req.user; anonymous requests (login, 401s) log a null user.
        user_id: req.user?.id ?? null,
        status: res.statusCode,
        duration_ms: Math.round(durationMs),
      });
    } catch (err) {
      console.error('activity log write failed:', err.message);
    }
  });

  next();
}

module.exports = { logActivity };

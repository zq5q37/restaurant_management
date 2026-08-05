/**
 * Date handling for scheduling.
 *
 * Everything is computed in UTC. Parsing '2026-08-10' with `new Date(str)` alone is
 * timezone-dependent and can land on the previous day west of Greenwich, which would silently
 * shift an entire generated week; appending 'T00:00:00Z' pins it.
 *
 * Weekdays are ISO-8601: 1 = Monday ... 7 = Sunday. Weeks start Monday.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isDateString(value) {
  return (
    typeof value === 'string' &&
    DATE_RE.test(value) &&
    // Rejects impossible dates like 2026-02-31, which the regex alone would accept.
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function isTimeString(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

function isoDayOfWeek(dateString) {
  const jsDay = new Date(`${dateString}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return jsDay === 0 ? 7 : jsDay;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Monday on or before the given date. */
function weekStart(dateString) {
  return addDays(dateString, -(isoDayOfWeek(dateString) - 1));
}

function weekDates(mondayString) {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayString, i));
}

/**
 * Turns a business date plus two clock times into absolute timestamps.
 * An end time at or before the start means the shift runs past midnight, so it lands
 * on the following day — this is what makes a 22:00-02:00 closing shift representable.
 */
function shiftBounds(dateString, startTime, endTime) {
  const starts_at = `${dateString} ${startTime}:00`;
  const endDate = endTime > startTime ? dateString : addDays(dateString, 1);
  return { starts_at, ends_at: `${endDate} ${endTime}:00` };
}

module.exports = {
  isDateString,
  isTimeString,
  isoDayOfWeek,
  addDays,
  weekStart,
  weekDates,
  shiftBounds,
};

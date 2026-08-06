/**
 * Display formatting shared by the charts and the reports around them.
 *
 * Kept out of charts.jsx so that file exports only components — a module mixing components
 * with plain functions loses fast refresh during development.
 */

const shortDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC', // dates are plain 'YYYY-MM-DD'; parsing them locally can shift the day
});

/** 'Mon 3' — short enough that a 30-day axis is not a wall of text. */
export const formatDate = (date) => shortDate.format(new Date(`${date}T00:00:00Z`));

/** 1,284 stays as it is; 12,900 becomes 12.9K. Big numbers are for reading, not counting. */
export function compact(value) {
  if (value == null) return '—';
  if (Math.abs(value) >= 10000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
}

/** Like formatPrice in api.js, but an em dash for "not known" rather than $NaN. */
export const money = (cents) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`);

/**
 * Date helpers for the schedule UI.
 *
 * These mirror backend/schedule/dates.js: dates are plain 'YYYY-MM-DD' strings and all
 * arithmetic goes through UTC, because parsing a bare date string in a timezone west of
 * Greenwich lands on the previous day and would shift the whole week by one.
 *
 * The one deliberately *local* value is today's date — "today" is the user's calendar day,
 * not the UTC one. It is turned into a date string immediately, so everything downstream
 * stays on the UTC path.
 */

const pad = (n) => String(n).padStart(2, '0');

export function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoDayOfWeek(dateString) {
  const jsDay = new Date(`${dateString}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return jsDay === 0 ? 7 : jsDay;
}

/** The Monday on or before the given date. */
export function weekStart(dateString) {
  return addDays(dateString, -(isoDayOfWeek(dateString) - 1));
}

export function weekDates(mondayString) {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayString, i));
}

const dayLabelFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const longDayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

const asDate = (dateString) => new Date(`${dateString}T00:00:00Z`);

/** 'Mon 3 Aug' */
export const formatDay = (dateString) => dayLabelFormat.format(asDate(dateString));

/** 'Monday 3 August' */
export const formatLongDay = (dateString) => longDayFormat.format(asDate(dateString));

export const formatWeekRange = (monday) => `${formatDay(monday)} – ${formatDay(addDays(monday, 6))}`;

/** Timestamps come back as 'YYYY-MM-DD HH:MM:SS'; the seconds are never meaningful here. */
export const timeOf = (stamp) => stamp.slice(11, 16);
export const dateOf = (stamp) => stamp.slice(0, 10);

/**
 * '17:00 – 01:00 (+1)' — the suffix marks a shift that finishes on the following day, which
 * is otherwise invisible when only the clock times are shown.
 */
export function formatShiftTime(shift) {
  const overnight = dateOf(shift.ends_at) !== dateOf(shift.starts_at);
  return `${timeOf(shift.starts_at)} – ${timeOf(shift.ends_at)}${overnight ? ' (+1)' : ''}`;
}

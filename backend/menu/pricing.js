/**
 * Prices are stored as whole cents. Formatting to a currency string is the frontend's job —
 * the API only ever speaks integers, so rounding never happens twice.
 */

/** Matches SQLite's datetime('now') output, so string comparison against stored stamps is valid. */
function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** A special counts only if it is set AND today falls inside its (optional) window. */
function isSpecialActive(item, now = nowStamp()) {
  if (item.special_price_cents == null && item.discount_percent == null) return false;
  if (item.special_starts_at && now < item.special_starts_at) return false;
  if (item.special_ends_at && now > item.special_ends_at) return false;
  return true;
}

function effectivePriceCents(item, now = nowStamp()) {
  if (!isSpecialActive(item, now)) return item.price_cents;
  if (item.special_price_cents != null) return item.special_price_cents;
  return Math.round((item.price_cents * (100 - item.discount_percent)) / 100);
}

/** Shapes a DB row for the API: real booleans, and the price the customer actually pays. */
function decorate(item) {
  const effective = effectivePriceCents(item);
  return {
    ...item,
    is_available: Boolean(item.is_available),
    effective_price_cents: effective,
    is_on_special: effective !== item.price_cents,
  };
}

module.exports = { nowStamp, isSpecialActive, effectivePriceCents, decorate };

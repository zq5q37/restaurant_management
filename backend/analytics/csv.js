/**
 * CSV serialisation for report export.
 *
 * Hand-rolled rather than pulled from npm: the whole format is four escaping rules, and they
 * are all here.
 */

/**
 * A field is quoted when it contains a comma, quote or newline, and quotes inside it are
 * doubled. Without this, a description like 'Toasted sourdough, with garlic' would silently
 * split into two columns.
 */
function escapeField(value) {
  if (value == null) return '';

  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param {Array<{key: string, label: string, map?: (row) => any}>} columns
 * @param {Array<object>} rows
 */
function toCsv(columns, rows) {
  const lines = [columns.map((c) => escapeField(c.label)).join(',')];

  for (const row of rows) {
    lines.push(
      columns.map((c) => escapeField(c.map ? c.map(row) : row[c.key])).join(',')
    );
  }

  // CRLF per RFC 4180 — Excel on Windows treats a bare LF file as one long row.
  return `${lines.join('\r\n')}\r\n`;
}

/** Cents to a plain decimal for spreadsheets: no currency symbol to confuse a SUM(). */
const centsToAmount = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(columns, rows));
}

module.exports = { toCsv, escapeField, centsToAmount, sendCsv };

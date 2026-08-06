import { useId, useState } from 'react';
import { compact, formatDate } from './format';
import './charts.css';

/**
 * Reusable chart primitives, drawn as plain SVG.
 *
 * No charting library: these are five shapes, and a dependency would cost more in bundle
 * size and API surface than the ~200 lines here. Every component follows the same rules —
 *
 *   - one series is one colour; hue never encodes a value the bar length already shows
 *   - marks are thin, gridlines are hairlines, and white space does the separating
 *   - hover and keyboard focus surface the same tooltip
 *   - every chart ships a table twin, so no value is reachable only by hovering
 *
 * The palette is the validated categorical set (see charts.css); slot 1 carries every
 * single-series chart, slot 2 joins it only where two things are genuinely compared.
 */

/* ------------------------------------------------------------------ helpers ---- */

/** A rounded cap on the value end only — the baseline end stays square. */
function barPath(x, y, width, height, radius = 4) {
  const r = Math.max(0, Math.min(radius, width, height / 2));
  if (r === 0) return `M${x},${y} h${width} v${height} h${-width} Z`;

  return [
    `M${x},${y}`,
    `H${x + width - r}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `V${y + height - r}`,
    `A${r},${r} 0 0 1 ${x + width - r},${y + height}`,
    `H${x}`,
    'Z',
  ].join(' ');
}

/** Same, rotated: rounded top for a column growing up from the axis. */
function columnPath(x, y, width, height, radius = 4) {
  const r = Math.max(0, Math.min(radius, height, width / 2));
  if (r === 0) return `M${x},${y} h${width} v${height} h${-width} Z`;

  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    `H${x + width - r}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `V${y + height}`,
    'Z',
  ].join(' ');
}

/** Positions a tooltip inside the card, flipping before it can overflow the right edge. */
function useTooltip() {
  const [tip, setTip] = useState(null);

  const show = (event, content) => {
    const box = event.currentTarget.closest('.chart-plot').getBoundingClientRect();
    const point = event.clientX
      ? { x: event.clientX - box.left, y: event.clientY - box.top }
      : (() => {
          // Keyboard focus has no pointer position, so anchor to the mark itself.
          const mark = event.currentTarget.getBoundingClientRect();
          return { x: mark.left - box.left + mark.width / 2, y: mark.top - box.top };
        })();

    setTip({ ...point, content, flip: point.x > box.width - 140 });
  };

  return [tip, show, () => setTip(null)];
}

function Tooltip({ tip }) {
  if (!tip) return null;

  return (
    <div
      className={`chart-tooltip${tip.flip ? ' chart-tooltip--flip' : ''}`}
      style={{ left: `${tip.x}px`, top: `${tip.y}px` }}
      role="presentation"
    >
      {tip.content}
    </div>
  );
}

/* ------------------------------------------------------------------- shells ---- */

/**
 * The frame every chart sits in: heading, the chart itself, and a toggle to the same
 * numbers as a table. The table is not a fallback — it is the accessible twin, and it is
 * what makes a hover-only value acceptable anywhere else.
 */
export function ChartCard({ title, subtitle, action, table, wide, children }) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();

  return (
    <section className={`chart-card${wide ? ' chart-card--wide' : ''}`}>
      <header className="chart-card__head">
        <div>
          <h3 id={id}>{title}</h3>
          {subtitle && <p className="chart-card__subtitle">{subtitle}</p>}
        </div>

        <div className="chart-card__actions">
          {action}
          {table && (
            <button type="button" onClick={() => setShowTable((open) => !open)}>
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </header>

      {showTable && table ? <DataTable {...table} /> : children}
    </section>
  );
}

export function DataTable({ columns, rows }) {
  return (
    <div className="chart-table-wrap">
      <table className="chart-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'is-numeric' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? row.key ?? index}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'is-numeric' : undefined}>
                  {c.map ? c.map(row) : row[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatTile({ label, value, sub, tone = 'default' }) {
  return (
    <div className={`stat-tile stat-tile--${tone}`}>
      <p className="stat-tile__label">{label}</p>
      <p className="stat-tile__value">{value}</p>
      {sub && <p className="stat-tile__sub">{sub}</p>}
    </div>
  );
}

export function EmptyChart({ children }) {
  return <p className="chart-empty">{children}</p>;
}

/* -------------------------------------------------------------- line chart ---- */

/**
 * A single measure over time. Only the last point is labelled: a number on every point
 * is noise, and the tooltip plus the table carry the rest.
 */
export function LineChart({ data, valueKey = 'value', label, formatValue = compact, height = 180 }) {
  const [tip, show, hide] = useTooltip();

  if (!data.length) return <EmptyChart>No data in this range.</EmptyChart>;

  const width = 640;
  const pad = { top: 12, right: 16, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const values = data.map((d) => d[valueKey]);
  // Always anchor at zero: a truncated axis exaggerates every wiggle into a cliff.
  const max = Math.max(1, ...values);
  const ticks = [0, max / 2, max];

  const x = (i) => pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[valueKey])}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${pad.top + plotH} L${x(0)},${pad.top + plotH} Z`;
  const last = data[data.length - 1];

  return (
    <div className="chart-plot">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img"
        aria-label={`${label}: ${formatValue(values.reduce((s, v) => s + v, 0))} in total across ${data.length} days`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={pad.left - 8} y={y(t) + 4} className="chart-axis-label" textAnchor="end">
              {formatValue(Math.round(t))}
            </text>
          </g>
        ))}

        <path d={area} className="chart-area" />
        <path d={line} className="chart-line" />

        {/* Endpoint marker with a surface ring, so it stays legible over the line. */}
        <circle cx={x(data.length - 1)} cy={y(last[valueKey])} r="4.5" className="chart-dot" />

        <text
          x={x(data.length - 1) - 6}
          y={y(last[valueKey]) - 10}
          className="chart-value-label"
          textAnchor="end"
        >
          {formatValue(last[valueKey])}
        </text>

        {/* First and last ticks only: 30 dates along one axis is unreadable. */}
        <text x={pad.left} y={height - 6} className="chart-axis-label">{formatDate(data[0].date)}</text>
        <text x={width - pad.right} y={height - 6} className="chart-axis-label" textAnchor="end">
          {formatDate(last.date)}
        </text>

        {/* Full-height hover bands: a 2px line is far too small a target to aim at. */}
        {data.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - plotW / data.length / 2}
            y={pad.top}
            width={plotW / data.length}
            height={plotH}
            className="chart-hitbox"
            tabIndex={0}
            onMouseMove={(e) => show(e, `${formatDate(d.date)}: ${formatValue(d[valueKey])} ${label}`)}
            onMouseLeave={hide}
            onFocus={(e) => show(e, `${formatDate(d.date)}: ${formatValue(d[valueKey])} ${label}`)}
            onBlur={hide}
          />
        ))}
      </svg>

      <Tooltip tip={tip} />
    </div>
  );
}

/* -------------------------------------------------------------- bar list ------ */

/**
 * Ranked magnitude by name — the right form whenever the categories are words. Horizontal
 * because a category label reads left-to-right; rotated x-axis text does not.
 */
export function BarList({ rows, labelKey = 'label', valueKey = 'value', formatValue = compact, note }) {
  const [tip, show, hide] = useTooltip();

  if (!rows.length) return <EmptyChart>No data in this range.</EmptyChart>;

  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  const rowH = 28;
  const barH = 16; // capped well under the row height, so the band keeps its air
  const width = 640;
  const labelW = 150;
  const valueW = 64;
  const trackW = width - labelW - valueW;

  return (
    <div className="chart-plot">
      <svg viewBox={`0 0 ${width} ${rows.length * rowH}`} className="chart-svg" role="img"
        aria-label={note || 'Ranked bar chart'}>
        {rows.map((row, i) => {
          const value = row[valueKey];
          const barW = (value / max) * trackW;
          const y = i * rowH;
          const content = `${row[labelKey]}: ${formatValue(value)}`;

          return (
            <g
              key={row.id ?? row[labelKey]}
              tabIndex={0}
              className="chart-bar-row"
              onMouseMove={(e) => show(e, content)}
              onMouseLeave={hide}
              onFocus={(e) => show(e, content)}
              onBlur={hide}
            >
              {/* Invisible full-width target: the bar itself can be a few pixels wide. */}
              <rect x="0" y={y} width={width} height={rowH} className="chart-hitbox" />

              <text x="0" y={y + rowH / 2 + 4} className="chart-cat-label">
                {row[labelKey]}
              </text>

              {value > 0 && (
                <path d={barPath(labelW, y + (rowH - barH) / 2, Math.max(2, barW), barH)} className="chart-bar" />
              )}

              {/* Value at the tip — never inside the bar, where a short bar would clip it. */}
              <text x={labelW + Math.max(2, barW) + 8} y={y + rowH / 2 + 4} className="chart-value-label">
                {formatValue(value)}
              </text>
            </g>
          );
        })}
      </svg>

      <Tooltip tip={tip} />
    </div>
  );
}

/* --------------------------------------------------------- stacked columns ---- */

/**
 * Two parts of one total per day — here, staffing filled versus still needed. Stacked
 * rather than side-by-side because the pair sums to something meaningful (what the
 * schedule asked for), and a 2px surface gap keeps the segments apart without a stroke.
 */
export function StackedColumns({ data, series, height = 190, formatValue = compact, unit = '' }) {
  const [tip, show, hide] = useTooltip();

  const totals = data.map((d) => series.reduce((sum, s) => sum + (d[s.key] ?? 0), 0));
  if (!totals.some((t) => t > 0)) return <EmptyChart>No data in this range.</EmptyChart>;

  const width = 640;
  const pad = { top: 12, right: 16, bottom: 26, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const max = Math.max(1, ...totals);
  const band = plotW / data.length;
  const barW = Math.min(24, band - 4);
  const GAP = 2;

  return (
    <div className="chart-plot">
      <ul className="chart-legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className={`chart-swatch chart-swatch--${s.tone}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>

      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img"
        aria-label={`Stacked columns: ${series.map((s) => s.label).join(' and ')} per day`}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={pad.top + plotH - (t / max) * plotH}
              y2={pad.top + plotH - (t / max) * plotH}
              className="chart-grid"
            />
            <text
              x={pad.left - 8}
              y={pad.top + plotH - (t / max) * plotH + 4}
              className="chart-axis-label"
              textAnchor="end"
            >
              {Math.round(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = pad.left + i * band + (band - barW) / 2;
          let cursor = pad.top + plotH;

          const content = (
            <>
              <strong>{formatDate(d.date)}</strong>
              {series.map((s) => (
                <span key={s.key}>
                  {s.label}: {formatValue(d[s.key] ?? 0)} {unit}
                </span>
              ))}
            </>
          );

          return (
            <g
              key={d.date}
              tabIndex={0}
              className="chart-bar-row"
              onMouseMove={(e) => show(e, content)}
              onMouseLeave={hide}
              onFocus={(e) => show(e, content)}
              onBlur={hide}
            >
              <rect x={pad.left + i * band} y={pad.top} width={band} height={plotH} className="chart-hitbox" />

              {series.map((s, index) => {
                const value = d[s.key] ?? 0;
                if (value <= 0) return null;

                const h = (value / max) * plotH;
                cursor -= h;
                const y = cursor;
                // The gap comes out of the segment below, never out of the top cap.
                const drawn = index === series.length - 1 ? h : Math.max(1, h - GAP);
                const isTop = series.slice(index + 1).every((rest) => !(d[rest.key] > 0));

                return isTop ? (
                  <path key={s.key} d={columnPath(x, y, barW, drawn)} className={`chart-fill chart-fill--${s.tone}`} />
                ) : (
                  <rect key={s.key} x={x} y={y} width={barW} height={drawn} className={`chart-fill chart-fill--${s.tone}`} />
                );
              })}
            </g>
          );
        })}

        <text x={pad.left} y={height - 6} className="chart-axis-label">{formatDate(data[0].date)}</text>
        <text x={width - pad.right} y={height - 6} className="chart-axis-label" textAnchor="end">
          {formatDate(data[data.length - 1].date)}
        </text>
      </svg>

      <Tooltip tip={tip} />
    </div>
  );
}

/* ------------------------------------------------------------------ meters ---- */

/**
 * A rate against its own 100% track. The track is a light step of the fill's own hue, so
 * "how much is missing" reads across the whole bar rather than only where the fill stops.
 */
export function MeterList({ rows }) {
  if (!rows.length) return <EmptyChart>No data in this range.</EmptyChart>;

  return (
    <ul className="meter-list">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="meter-list__head">
            <span>{row.label}</span>
            <strong>{row.value == null ? '—' : `${row.value}%`}</strong>
          </div>

          <div
            className="meter"
            role="meter"
            aria-valuenow={row.value ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${row.label} coverage`}
          >
            <span
              className={`meter__fill meter__fill--${row.tone ?? 'default'}`}
              style={{ width: `${Math.min(100, row.value ?? 0)}%` }}
            />
          </div>

          {row.note && <p className="meter-list__note">{row.note}</p>}
        </li>
      ))}
    </ul>
  );
}

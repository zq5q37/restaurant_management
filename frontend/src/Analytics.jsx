import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import PageHead from './PageHead';
import { PAGE_JP } from './labels';
import { addDays, todayString, weekStart } from './dates';
import {
  BarList,
  ChartCard,
  DataTable,
  EmptyChart,
  LineChart,
  MeterList,
  StackedColumns,
  StatTile,
} from './charts';
import { compact, formatDate, money } from './format';
import './analytics.css';

/**
 * The reporting dashboard: four reports over one shared date range.
 *
 * Every section reads from `/api/analytics/*`, which does the aggregation in SQL — the
 * browser receives summarised rows, never a month of raw events to add up itself.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'popular', label: 'Popular items' },
  { key: 'schedule', label: 'Scheduling' },
  { key: 'menu', label: 'Menu & profit' },
  // Matrix: "View user activity / system usage" is admin-only, unlike the rest of the dashboard.
  { key: 'system', label: 'System usage', adminOnly: true },
];

/** Presets first, custom dates behind them — the presets answer most questions. */
const PRESETS = [
  { key: '7', label: 'Last 7 days', from: (today) => addDays(today, -6) },
  { key: '30', label: 'Last 30 days', from: (today) => addDays(today, -29) },
  { key: '90', label: 'Last 90 days', from: (today) => addDays(today, -89) },
  { key: 'week', label: 'This week', from: (today) => weekStart(today) },
  { key: 'month', label: 'This month', from: (today) => `${today.slice(0, 7)}-01` },
];

/** Where each tab's data and its CSV come from. `null` means the section has no export. */
const SOURCES = {
  overview: { path: 'overview', csv: null },
  popular: { path: 'popular-items', csv: 'popular-items' },
  schedule: { path: 'schedule', csv: 'schedule' },
  menu: { path: 'menu', csv: 'menu' },
  system: { path: 'system', csv: 'system' },
};

function Analytics({ token, user, onUnauthorized }) {
  const isAdmin = user.role === 'admin';
  const today = todayString();

  const [tab, setTab] = useState('overview');
  const [preset, setPreset] = useState('30');
  const [from, setFrom] = useState(() => addDays(todayString(), -29));
  const [to, setTo] = useState(today);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const tabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const source = SOURCES[tab];
  const query = `from=${from}&to=${to}`;

  // Only render a payload that belongs to the tab on screen.
  const shown = data?.tab === tab ? data.payload : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    apiFetch(`/api/analytics/${source.path}?${query}`, { token })
      .then((result) => {
        // Tagged with its tab: holding the previous render through a *range* change is
        // deliberate, but each tab has a different response shape, so a payload must never
        // be rendered by the section it did not come from.
        if (!cancelled) setData({ tab, payload: result });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401) return onUnauthorized();
        setError(err.message);
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `tab` is listed because the payload is tagged with it; today it always changes in step
    // with source.path, but relying on that coupling is how a stale tag gets shipped later.
  }, [token, tab, source.path, query, onUnauthorized]);

  function applyPreset(key) {
    const found = PRESETS.find((p) => p.key === key);
    setPreset(key);
    if (found) {
      setFrom(found.from(today));
      setTo(today);
    }
  }

  /**
   * CSV download. Goes through fetch rather than a plain link because the endpoint needs the
   * bearer token, and an <a href> cannot carry one.
   */
  async function downloadCsv() {
    setError('');
    setExporting(true);

    try {
      const res = await fetch(`/api/analytics/${source.path}?${query}&format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return onUnauthorized();
      if (!res.ok) throw new Error(`Export failed (${res.status})`);

      // Prefer the server's filename, which already carries the date range.
      const disposition = res.headers.get('Content-Disposition') || '';
      const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? `${source.csv}_${from}_to_${to}.csv`;

      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="analytics">
      {/* No side figure: the range is a filter, not a measure, and it is already stated under
          the tabs. A header that repeats what is directly below it gets read as neither. */}
      <PageHead
        kicker={PAGE_JP.analytics}
        title="The numbers"
        sub="What the menu, the roster and the system have been doing over the range below."
      />

      {/* One filter row above everything it scopes, so every chart shows the same slice. */}
      <div className="analytics-filters">
        <ul className="chip-row" aria-label="Date range">
          {PRESETS.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                className="chip"
                onClick={() => applyPreset(p.key)}
                aria-pressed={preset === p.key}
              >
                {p.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="analytics-custom">
          <label htmlFor="an-from">From</label>
          <input
            id="an-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPreset('custom');
            }}
          />
          <label htmlFor="an-to">To</label>
          <input
            id="an-to"
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => {
              setTo(e.target.value);
              setPreset('custom');
            }}
          />
        </div>

        <div className="analytics-exports">
          {source.csv && (
            <button
              type="button"
              className="button--ghost"
              onClick={downloadCsv}
              disabled={exporting || loading}
            >
              {exporting ? 'Preparing...' : 'Export CSV'}
            </button>
          )}
          <button type="button" className="button--ghost" onClick={() => window.print()}>
            Save as PDF
          </button>
        </div>
      </div>

      <div className="analytics-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="analytics-range" role="status">
        {loading ? 'Updating...' : `${formatDate(from)} to ${formatDate(to)}`}
      </p>

      {error && (
        <p role="alert" className="analytics-error">
          {error}
        </p>
      )}

      {/* Previous render is held at reduced opacity while refetching: a skeleton flash here
          would move every chart on the page each time the range changes. */}
      <div className={loading ? 'analytics-body is-loading' : 'analytics-body'}>
        {shown && tab === 'overview' && <Overview data={shown} />}
        {shown && tab === 'popular' && <Popular data={shown} />}
        {shown && tab === 'schedule' && <Schedule data={shown} />}
        {shown && tab === 'menu' && <MenuReport data={shown} />}
        {shown && tab === 'system' && <System data={shown} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- overview ---- */

function Overview({ data }) {
  const { menu, views, schedule } = data;

  return (
    <>
      <div className="stat-grid">
        <StatTile label="Menu views" value={compact(views.total)} sub="in the selected range" />
        <StatTile
          label="Theoretical profit"
          value={money(menu.theoretical_profit_cents)}
          sub="views × margin"
        />
        <StatTile
          label="Average margin"
          value={menu.average_margin_percent == null ? '—' : `${menu.average_margin_percent}%`}
          sub={menu.missing_cost ? `${menu.missing_cost} item without a cost` : 'all items costed'}
          tone={menu.missing_cost ? 'warning' : 'good'}
        />
        <StatTile
          label="Shift coverage"
          value={schedule.coverage_rate == null ? '—' : `${schedule.coverage_rate}%`}
          sub={`${schedule.assigned} of ${schedule.required} places filled`}
          tone={coverageTone(schedule.coverage_rate)}
        />
      </div>

      <ChartCard
        title="Menu views per day"
        subtitle="How much interest the menu attracted, day by day"
        table={{
          columns: [
            { key: 'date', label: 'Date', map: (r) => formatDate(r.date) },
            { key: 'views', label: 'Views', numeric: true },
          ],
          rows: views.by_day.map((d) => ({ ...d, key: d.date })),
        }}
      >
        <LineChart data={views.by_day} valueKey="views" label="views" />
      </ChartCard>
    </>
  );
}

const coverageTone = (rate) => {
  if (rate == null) return 'default';
  if (rate >= 90) return 'good';
  return rate >= 70 ? 'warning' : 'critical';
};

/* ---------------------------------------------------------- popular items ---- */

function Popular({ data }) {
  const { items, by_category, by_day } = data;

  return (
    <>
      <ChartCard
        title="Most viewed items"
        subtitle="There is no ordering in the system, so views are the demand signal"
        table={{
          columns: [
            { key: 'name', label: 'Item' },
            { key: 'category_name', label: 'Category' },
            { key: 'views', label: 'Views', numeric: true },
            { key: 'unique_viewers', label: 'Unique viewers', numeric: true },
          ],
          rows: items,
        }}
      >
        <BarList
          rows={items}
          labelKey="name"
          valueKey="views"
          note="Menu items ranked by views"
        />
      </ChartCard>

      <ChartCard
        title="Views by category"
        table={{
          columns: [
            { key: 'category_name', label: 'Category' },
            { key: 'views', label: 'Views', numeric: true },
          ],
          rows: by_category.map((c) => ({ ...c, key: c.category_name })),
        }}
      >
        <BarList
          rows={by_category}
          labelKey="category_name"
          valueKey="views"
          note="Categories ranked by views"
        />
      </ChartCard>

      <ChartCard
        title="Views per day"
        table={{
          columns: [
            { key: 'date', label: 'Date', map: (r) => formatDate(r.date) },
            { key: 'views', label: 'Views', numeric: true },
          ],
          rows: by_day.map((d) => ({ ...d, key: d.date })),
        }}
      >
        <LineChart data={by_day} valueKey="views" label="views" />
      </ChartCard>
    </>
  );
}

/* -------------------------------------------------------------- scheduling ---- */

function Schedule({ data }) {
  const { summary, by_day, by_role, utilisation } = data;

  // The stacked pair is "filled" and "still needed", which together are what was asked for.
  const coverage = by_day.map((d) => ({
    ...d,
    unfilled: Math.max(0, d.required - d.assigned),
  }));

  return (
    <>
      <div className="stat-grid">
        <StatTile label="Shifts" value={compact(summary.shifts)} sub="in the selected range" />
        <StatTile
          label="Coverage"
          value={summary.coverage_rate == null ? '—' : `${summary.coverage_rate}%`}
          sub={`${summary.assigned} of ${summary.required} places filled`}
          tone={coverageTone(summary.coverage_rate)}
        />
        <StatTile
          label="Unfilled places"
          value={compact(summary.unfilled)}
          sub="assignments still needed"
          tone={summary.unfilled ? 'warning' : 'good'}
        />
        <StatTile
          label="Fully covered shifts"
          value={`${summary.covered_shifts}/${summary.shifts}`}
          sub="shifts at or above required staff"
        />
      </div>

      <ChartCard
        title="Coverage per day"
        subtitle="Filled places against places still needed"
        table={{
          columns: [
            { key: 'date', label: 'Date', map: (r) => formatDate(r.date) },
            { key: 'required', label: 'Required', numeric: true },
            { key: 'assigned', label: 'Filled', numeric: true },
            { key: 'unfilled', label: 'Unfilled', numeric: true },
            {
              key: 'coverage_rate',
              label: 'Coverage',
              numeric: true,
              map: (r) => (r.coverage_rate == null ? '—' : `${r.coverage_rate}%`),
            },
          ],
          rows: coverage.map((d) => ({ ...d, key: d.date })),
        }}
      >
        <StackedColumns
          data={coverage}
          unit="places"
          series={[
            { key: 'assigned', label: 'Filled', tone: 'primary' },
            { key: 'unfilled', label: 'Still needed', tone: 'secondary' },
          ]}
        />
      </ChartCard>

      <ChartCard title="Coverage by role" subtitle="Which jobs are hard to staff">
        <MeterList
          rows={by_role.map((r) => ({
            label: r.role,
            value: r.coverage_rate,
            tone: r.coverage_rate >= 90 ? 'default' : r.coverage_rate >= 70 ? 'warning' : 'critical',
            note: `${r.assigned} of ${r.required} places across ${r.shifts} shift${r.shifts === 1 ? '' : 's'}`,
          }))}
        />
      </ChartCard>

      <ChartCard
        title="Staff utilisation"
        subtitle="Rostered hours per person"
        table={{
          columns: [
            { key: 'full_name', label: 'Name' },
            { key: 'role', label: 'Role' },
            { key: 'shifts', label: 'Shifts', numeric: true },
            { key: 'hours', label: 'Hours', numeric: true },
            { key: 'share_percent', label: 'Share', numeric: true, map: (r) => `${r.share_percent}%` },
          ],
          rows: utilisation,
        }}
      >
        <BarList
          rows={utilisation}
          labelKey="full_name"
          valueKey="hours"
          formatValue={(h) => `${h}h`}
          note="Staff ranked by rostered hours"
        />
      </ChartCard>
    </>
  );
}

/* -------------------------------------------------------------------- menu ---- */

function MenuReport({ data }) {
  const { items, by_category } = data;

  const costed = items.filter((i) => i.margin_cents != null);
  const missing = items.length - costed.length;
  const best = [...costed].sort((a, b) => b.margin_percent - a.margin_percent)[0];

  return (
    <>
      <div className="stat-grid">
        <StatTile
          label="Theoretical profit"
          value={money(items.reduce((s, i) => s + (i.theoretical_profit_cents ?? 0), 0))}
          sub="if every view converted once"
        />
        <StatTile
          label="Best margin"
          value={best ? `${best.margin_percent}%` : '—'}
          sub={best ? best.name : 'no costed items'}
          tone="good"
        />
        <StatTile
          label="Items on special"
          value={compact(items.filter((i) => i.is_on_special).length)}
          sub={`of ${items.length} items`}
        />
        <StatTile
          label="Missing a cost"
          value={compact(missing)}
          sub={missing ? 'excluded from margin figures' : 'every item is costed'}
          tone={missing ? 'warning' : 'good'}
        />
      </div>

      <ChartCard
        title="Theoretical profit by category"
        subtitle="Views in range × margin per item"
        table={{
          columns: [
            { key: 'category_name', label: 'Category' },
            { key: 'items', label: 'Items', numeric: true },
            { key: 'views', label: 'Views', numeric: true },
            {
              key: 'theoretical_profit_cents',
              label: 'Theoretical profit',
              numeric: true,
              map: (r) => money(r.theoretical_profit_cents),
            },
          ],
          rows: by_category.map((c) => ({ ...c, key: c.category_name })),
        }}
      >
        <BarList
          rows={by_category}
          labelKey="category_name"
          valueKey="theoretical_profit_cents"
          formatValue={money}
          note="Categories ranked by theoretical profit"
        />
      </ChartCard>

      <ChartCard
        title="Pricing and margin by item"
        subtitle="Cost is set per item in the menu editor"
        wide
      >
        <DataTable
          columns={[
            { key: 'name', label: 'Item' },
            { key: 'category_name', label: 'Category' },
            { key: 'price_cents', label: 'Price', numeric: true, map: (r) => money(r.price_cents) },
            {
              key: 'effective_price_cents',
              label: 'Charged',
              numeric: true,
              map: (r) => `${money(r.effective_price_cents)}${r.is_on_special ? ' *' : ''}`,
            },
            { key: 'cost_cents', label: 'Cost', numeric: true, map: (r) => money(r.cost_cents) },
            {
              key: 'margin_percent',
              label: 'Margin',
              numeric: true,
              map: (r) => (r.margin_percent == null ? '—' : `${r.margin_percent}%`),
            },
            { key: 'views', label: 'Views', numeric: true },
            {
              key: 'theoretical_profit_cents',
              label: 'Theoretical profit',
              numeric: true,
              map: (r) => money(r.theoretical_profit_cents),
            },
          ]}
          rows={items}
        />
        <p className="analytics-footnote">* currently on special — margin uses the discounted price.</p>
      </ChartCard>
    </>
  );
}

/* ------------------------------------------------------------------ system ---- */

function System({ data }) {
  const { summary, by_day, endpoints, users } = data;

  return (
    <>
      <div className="stat-grid">
        <StatTile label="Requests" value={compact(summary.requests)} sub="API calls in range" />
        <StatTile
          label="Active users"
          value={compact(summary.active_users)}
          sub="accounts that made a request"
        />
        <StatTile
          label="Response time"
          value={`${summary.avg_ms} ms`}
          sub={`p95 ${summary.p95_ms} ms · max ${summary.max_ms} ms`}
        />
        <StatTile
          label="Error rate"
          value={`${summary.error_rate}%`}
          sub={`${summary.client_errors} client · ${summary.server_errors} server`}
          tone={summary.server_errors ? 'critical' : summary.error_rate > 5 ? 'warning' : 'good'}
        />
      </div>

      <ChartCard
        title="Requests per day"
        table={{
          columns: [
            { key: 'date', label: 'Date', map: (r) => formatDate(r.date) },
            { key: 'requests', label: 'Requests', numeric: true },
            { key: 'errors', label: 'Errors', numeric: true },
            { key: 'avg_ms', label: 'Avg ms', numeric: true },
          ],
          rows: by_day.map((d) => ({ ...d, key: d.date })),
        }}
      >
        <LineChart data={by_day} valueKey="requests" label="requests" />
      </ChartCard>

      <ChartCard title="Busiest endpoints" subtitle="Where the time goes" wide>
        {endpoints.length ? (
          <DataTable
            columns={[
              { key: 'endpoint', label: 'Endpoint' },
              { key: 'requests', label: 'Requests', numeric: true },
              { key: 'avg_ms', label: 'Avg ms', numeric: true },
              { key: 'max_ms', label: 'Max ms', numeric: true },
              { key: 'errors', label: 'Errors', numeric: true },
            ]}
            rows={endpoints.map((e) => ({ ...e, key: e.endpoint }))}
          />
        ) : (
          <EmptyChart>No requests recorded in this range.</EmptyChart>
        )}
      </ChartCard>

      <ChartCard
        title="User activity"
        subtitle="Requests per account, and when each was last seen"
        wide
      >
        <DataTable
          columns={[
            { key: 'full_name', label: 'Name' },
            { key: 'role', label: 'Role' },
            {
              key: 'is_active',
              label: 'Account',
              map: (r) => (r.is_active ? 'Active' : 'Deactivated'),
            },
            { key: 'requests', label: 'Requests', numeric: true },
            { key: 'last_seen', label: 'Last seen', map: (r) => r.last_seen ?? '—' },
          ]}
          rows={users}
        />
      </ChartCard>
    </>
  );
}

export default Analytics;

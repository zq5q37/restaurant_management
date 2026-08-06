import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import ShiftEditor from './ShiftEditor';
import PageHead from './PageHead';
import { PAGE_JP } from './labels';
import {
  addDays,
  formatDay,
  formatLongDay,
  formatShiftTime,
  formatWeekRange,
  todayString,
  weekStart,
} from './dates';
import './schedule.css';

/**
 * The schedule page: one week at a time, viewable as a seven-day overview or a single day.
 *
 * Both views are served by one request. `GET /api/schedule/week` already returns the week
 * bucketed into days with assignments attached, so switching to the day view is a filter on
 * data we hold rather than another round trip.
 */
function Schedule({ token, user, onUnauthorized }) {
  // Both the coverage figures and every write control below are manager+ rows in
  // docs/permission-matrix.md, so one flag gates them all. Hiding them is presentation only —
  // the API returns 403 to anyone else regardless.
  const canManage = user.role === 'manager' || user.role === 'admin';

  const [monday, setMonday] = useState(() => weekStart(todayString()));
  const [view, setView] = useState('week');
  // Invariant: always inside the displayed week. Every week change moves it along too.
  const [selectedDate, setSelectedDate] = useState(todayString);

  const [week, setWeek] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // `editing` is null (closed), 'new', or the shift being edited. `refreshKey` re-runs the
  // week query after any mutation so the grid never drifts from the server.
  const [editing, setEditing] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const today = todayString();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    // Coverage is manager+ only and purely supplementary, so a failure there must not blank
    // out the schedule itself.
    const coveragePromise = canManage
      ? apiFetch(`/api/schedule/coverage?week_start=${monday}`, { token }).catch(() => null)
      : Promise.resolve(null);

    Promise.all([apiFetch(`/api/schedule/week?week_start=${monday}`, { token }), coveragePromise])
      .then(([weekData, coverageData]) => {
        if (cancelled) return;
        setWeek(weekData);
        setCoverage(coverageData);
        // Re-point an open editor at the freshly loaded row so its assignment list stays
        // current; a shift that has been deleted or moved out of the week closes it.
        setEditing((current) => {
          if (!current || current === 'new') return current;
          const shifts = weekData.days.flatMap((d) => d.shifts);
          return shifts.find((s) => s.id === current.id) ?? null;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401) return onUnauthorized();
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, monday, refreshKey, canManage, onUnauthorized]);

  // The assignment picker needs names. Customers are excluded because the API refuses them
  // (409), as are deactivated accounts — offering a choice that cannot succeed is not a choice.
  useEffect(() => {
    if (!canManage) return;

    apiFetch('/api/users', { token })
      .then((data) => setStaff(data.users.filter((u) => u.is_active && u.role !== 'customer')))
      .catch(() => setStaff([]));
  }, [token, canManage]);

  const refresh = () => setRefreshKey((n) => n + 1);

  /** Shared shape for the toolbar's week-level actions. */
  async function runWeekAction(path, describe) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await apiFetch(path, { token, method: 'POST', body: { week_start: monday } });
      setNotice(describe(result));
      refresh();
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const generateWeek = () =>
    runWeekAction(
      '/api/schedule/generate',
      (r) =>
        `Generated from ${r.templates_considered} template${r.templates_considered === 1 ? '' : 's'}: ` +
        `${r.shifts_created} shift${r.shifts_created === 1 ? '' : 's'} created, ${r.shifts_skipped} already existed.`
    );

  const publishWeek = () =>
    runWeekAction(
      '/api/schedule/publish',
      (r) => `Week published — ${r.notified} ${r.notified === 1 ? 'person' : 'people'} notified.`
    );

  /** Keeps the open editor pointed at the freshly saved row rather than a stale copy. */
  function handleSaved(result) {
    setNotice('');
    refresh();
    if (result?.shift) setEditing(result.shift);
  }

  function handleDeleted() {
    setEditing(null);
    setNotice('Shift deleted.');
    refresh();
  }

  /** Moves the week while keeping the same weekday selected, so Friday stays Friday. */
  function goToWeek(nextMonday) {
    const offset = week ? week.days.findIndex((d) => d.date === selectedDate) : 0;
    setMonday(nextMonday);
    setSelectedDate(addDays(nextMonday, offset === -1 ? 0 : offset));
  }

  function goToToday() {
    setMonday(weekStart(today));
    setSelectedDate(today);
  }

  function showDay(date) {
    setSelectedDate(date);
    setView('day');
  }

  const days = week?.days ?? [];
  const selectedDay = days.find((d) => d.date === selectedDate) ?? null;

  const totalShifts = days.reduce((sum, day) => sum + day.shifts.length, 0);

  const isCurrentWeek = monday === weekStart(today);

  return (
    <div className="schedule">
      <PageHead
        kicker={PAGE_JP.schedule}
        title="The week"
        sub={
          week?.scope === 'own'
            ? 'The shifts you are on. Times are the hours the kitchen expects you.'
            : 'Who is on, and where the gaps are. Generated from the weekly templates.'
        }
        sideValue={loading && !week ? '—' : totalShifts}
        sideLabel={totalShifts === 1 ? 'shift' : 'shifts'}
      />

      <div className="schedule-toolbar">
        <div className="schedule-week-nav">
          <button className="button--ghost" type="button" onClick={() => goToWeek(addDays(monday, -7))}>
            ← Previous
          </button>
          <strong className="schedule-week-label">{formatWeekRange(monday)}</strong>
          <button className="button--ghost" type="button" onClick={() => goToWeek(addDays(monday, 7))}>
            Next →
          </button>
          <button className="button--ghost" type="button" onClick={goToToday} disabled={isCurrentWeek && selectedDate === today}>
            Today
          </button>
        </div>

        <div className="segmented" role="group" aria-label="View">
          <button type="button" onClick={() => setView('week')} aria-pressed={view === 'week'}>
            Week
          </button>
          <button type="button" onClick={() => setView('day')} aria-pressed={view === 'day'}>
            Day
          </button>
        </div>

        {canManage && (
          <div className="schedule-actions">
            <button type="button" className="button--ghost" onClick={generateWeek} disabled={busy}>
              Generate from templates
            </button>
            <button
              type="button"
              className="button--ghost"
              onClick={publishWeek}
              disabled={busy || totalShifts === 0}
            >
              Publish week
            </button>
            <button type="button" onClick={() => setEditing('new')}>
              + New shift
            </button>
          </div>
        )}
      </div>

      {/* The count lives in the header band; this line only carries what the header cannot. */}
      {(loading || week?.scope === 'own') && (
        <p className="schedule-status" role="status">
          {loading ? 'Loading...' : 'Showing only shifts you are assigned to.'}
        </p>
      )}

      {error && (
        <p role="alert" className="form-error schedule-error">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="notice schedule-notice">
          {notice}
        </p>
      )}

      {/* Nothing to say about coverage in a week with no shifts in it yet. */}
      {canManage && coverage?.total_shifts > 0 && <CoverageSummary coverage={coverage} />}

      {canManage && editing && (
        <div className="schedule-panel">
          <ShiftEditor
            // Keyed by shift so switching which one is open resets the form, while a refresh of
            // the same shift keeps what has been typed.
            key={editing === 'new' ? 'new' : editing.id}
            token={token}
            shift={editing === 'new' ? null : editing}
            staff={staff}
            defaultDate={selectedDate}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onUnauthorized={onUnauthorized}
          />
        </div>
      )}

      {!error && week && (
        <>
          {/* The day strip doubles as the day picker and as a per-day count in week view. */}
          <ol className="schedule-daybar">
            {days.map((day) => (
              <li key={day.date}>
                <button
                  type="button"
                  className={
                    'schedule-daybar__day' +
                    (day.date === selectedDate && view === 'day' ? ' is-selected' : '') +
                    (day.date === today ? ' is-today' : '')
                  }
                  onClick={() => showDay(day.date)}
                  aria-current={day.date === selectedDate && view === 'day' ? 'date' : undefined}
                >
                  <span className="schedule-daybar__label">{formatDay(day.date)}</span>
                  <span className="schedule-daybar__count">
                    {day.shifts.length || '—'}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {view === 'week' ? (
            <div className="schedule-week">
              {days.map((day) => (
                <section
                  key={day.date}
                  className={'schedule-day' + (day.date === today ? ' is-today' : '')}
                >
                  <h2 className="schedule-day__heading">
                    {formatDay(day.date)}
                    {day.date === today && <span className="schedule-chip">Today</span>}
                  </h2>

                  {day.shifts.length === 0 ? (
                    <p className="schedule-day__empty">No shifts</p>
                  ) : (
                    <ul className="schedule-day__shifts">
                      {day.shifts.map((shift) => (
                        <li key={shift.id}>
                          <ShiftCard
                            shift={shift}
                            canManage={canManage}
                            onEdit={setEditing}
                            isOpen={editing !== 'new' && editing?.id === shift.id}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <DayDetail
              day={selectedDay}
              date={selectedDate}
              canManage={canManage}
              editing={editing}
              onEdit={setEditing}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Manager+ only: the week's staffing at a glance, from GET /api/schedule/coverage. */
function CoverageSummary({ coverage }) {
  const short = coverage.uncovered_shifts > 0;

  return (
    <div className={'schedule-coverage' + (short ? ' is-short' : '')}>
      <span>
        <strong>{coverage.covered_shifts}</strong> of {coverage.total_shifts} shifts covered
      </span>
      {short ? (
        <span>
          <strong>{coverage.uncovered_shifts}</strong> understaffed &mdash;{' '}
          <strong>{coverage.staff_needed}</strong> more assignment
          {coverage.staff_needed === 1 ? '' : 's'} needed
        </span>
      ) : (
        <span>Fully staffed</span>
      )}
    </div>
  );
}

/** The single-day view: the same shifts, with room for assignees and notes. */
function DayDetail({ day, date, canManage, editing, onEdit }) {
  const shifts = day?.shifts ?? [];

  return (
    <section className="schedule-detail">
      <h2 className="schedule-detail__heading">{formatLongDay(date)}</h2>

      {shifts.length === 0 ? (
        <p className="schedule-day__empty">No shifts scheduled for this day.</p>
      ) : (
        <ul className="schedule-detail__list">
          {shifts.map((shift) => (
            <li key={shift.id} className="schedule-detail__row">
              <div className="schedule-detail__time">{formatShiftTime(shift)}</div>

              <div className="schedule-detail__body">
                <h3>
                  {shift.role}
                  {canManage && <StaffingBadge shift={shift} />}
                </h3>

                {shift.assignments.length === 0 ? (
                  <p className="schedule-detail__nobody">Nobody assigned</p>
                ) : (
                  <ul className="schedule-detail__people">
                    {shift.assignments.map((a) => (
                      <li key={a.user_id}>{a.full_name}</li>
                    ))}
                  </ul>
                )}

                {shift.notes && <p className="schedule-detail__notes">{shift.notes}</p>}
              </div>

              {canManage && (
                <div className="schedule-detail__actions">
                  <button
                    type="button"
                    className="button--ghost"
                    onClick={() => onEdit(shift)}
                    disabled={editing !== 'new' && editing?.id === shift.id}
                  >
                    Edit / assign
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ShiftCard({ shift, canManage, onEdit, isOpen }) {
  return (
    <article className={'schedule-shift' + (canManage && !shift.is_covered ? ' is-short' : '')}>
      <p className="schedule-shift__time">{formatShiftTime(shift)}</p>
      <p className="schedule-shift__role">
        {shift.role}
        {canManage && <StaffingBadge shift={shift} />}
      </p>

      {shift.assignments.length > 0 && (
        <ul className="schedule-shift__people">
          {shift.assignments.map((a) => (
            <li key={a.user_id}>{a.full_name}</li>
          ))}
        </ul>
      )}

      {canManage && (
        <button type="button" className="schedule-shift__edit" onClick={() => onEdit(shift)} disabled={isOpen}>
          Edit
        </button>
      )}
    </article>
  );
}

/**
 * Staffing counts are gated on `canManage` by the callers: "View coverage gaps" is a
 * manager+ row in the permission matrix, so staff see the shift without the headcount.
 */
function StaffingBadge({ shift }) {
  return (
    <span
      className={'schedule-badge' + (shift.is_covered ? '' : ' schedule-badge--short')}
      title={shift.is_covered ? 'Fully staffed' : 'Understaffed'}
    >
      {shift.assigned_count}/{shift.required_staff}
    </span>
  );
}

export default Schedule;

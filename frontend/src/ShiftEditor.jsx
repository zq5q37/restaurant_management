import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { formatLongDay, timeOf } from './dates';

// Mirrors SHIFT_ROLES in backend/schedule/store.js — anything else is a 400 from the API.
const SHIFT_ROLES = ['server', 'host', 'cleaner', 'cook'];

/** Initials for the assignee discs. Two letters at most, or the calendar row gets noisy. */
function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/* ------------------------------------------------------------------- icons ---- */

/*
 * UI glyphs, inline. A sprite file would be one more asset to keep in step for four shapes
 * that are each a couple of paths, and these have to take `currentColor` from the row they
 * sit in so they dim with it.
 */
const Icon = ({ path, ...rest }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
    {path}
  </svg>
);

const ClockIcon = (props) => (
  <Icon
    {...props}
    path={
      <>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 7.5V12l3 1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    }
  />
);

const PeopleIcon = (props) => (
  <Icon
    {...props}
    path={
      <>
        <circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 19c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16.5 6.6a3 3 0 0 1 0 5.6M17.5 14.6c2.1.5 3.5 2 3.5 4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    }
  />
);

const NoteIcon = (props) => (
  <Icon
    {...props}
    path={
      <>
        <path d="M5 4.5h14v15H5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 9h8M8 12.5h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    }
  />
);

const CloseIcon = (props) => (
  <Icon
    {...props}
    path={<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
  />
);

const TrashIcon = (props) => (
  <Icon
    {...props}
    path={
      <>
        <path d="M4.5 6.5h15M9.5 6.5V4.8h5v1.7M7 6.5l.9 12.2h8.2L17 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    }
  />
);

/* ------------------------------------------------------------------ editor ---- */

/**
 * Create or edit one shift, laid out the way a calendar app lays out an event.
 *
 * The shape is borrowed from Google Calendar because a shift *is* a calendar event and the
 * conventions are already in people's hands: a dialog over the week rather than a panel that
 * shoves it down the page, the title first and largest, one line for the date and the two
 * times, and every other row hanging off an icon in a left gutter so the eye can find the
 * one it wants without reading labels. Everything is Rokushichi's own tokens — the borrowing
 * is the structure, not Google's blue.
 *
 * A native <dialog> carries the modal behaviour: focus is trapped, the page behind is inert,
 * Escape closes, and the backdrop is a pseudo-element. All of that would otherwise be a
 * few hundred lines of focus management to get wrong.
 *
 * Assignments only appear when editing an existing shift: they need a shift id, and the
 * conflict check the API runs has nothing to compare against until the shift has real times.
 */
function ShiftEditor({ token, shift, staff, defaultDate, onClose, onSaved, onDeleted, onUnauthorized }) {
  const isNew = !shift;
  const dialogRef = useRef(null);

  const [shiftDate, setShiftDate] = useState(shift?.shift_date ?? defaultDate);
  const [startTime, setStartTime] = useState(shift ? timeOf(shift.starts_at) : '09:00');
  const [endTime, setEndTime] = useState(shift ? timeOf(shift.ends_at) : '17:00');
  const [role, setRole] = useState(shift?.role ?? SHIFT_ROLES[0]);
  const [requiredStaff, setRequiredStaff] = useState(String(shift?.required_staff ?? 1));
  const [notes, setNotes] = useState(shift?.notes ?? '');

  const [assignee, setAssignee] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Held in a ref so the effect below can stay mount-only: Schedule passes a new arrow
  // function every render, and depending on it would tear down and re-open the dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    // showModal() rather than the `open` attribute: only the former makes the dialog modal,
    // and without it there is no focus trap, no inert background and no Escape handling.
    if (!dialog.open) dialog.showModal();

    /*
     * Escape is handled here rather than left to the dialog's own behaviour, and the default
     * is prevented so the browser does not close the element behind React's back.
     *
     * The reason is a failure that is invisible until you try it twice: a dialog closed by
     * the browser goes to `open === false` but stays mounted, because `editing` in Schedule
     * is still set. Clicking Edit on that same shift then changes no state, nothing
     * re-renders, and the editor simply never reappears. Driving the close through React
     * instead means the element is unmounted, which cannot get out of step.
     *
     * (The `close` event would be the natural hook and is deliberately not used: it did not
     * fire at all under test — reproduced on a bare dialog with no React attached — so
     * hanging the only exit on it would have shipped that dead end.)
     */
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, []);

  /** Every request goes through here so 401 handling and error display are never forgotten. */
  async function run(fn) {
    setError('');
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      else setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const required_staff = Number(requiredStaff);
    if (!Number.isInteger(required_staff) || required_staff < 1) {
      setError('Staff needed must be a whole number of at least 1');
      return;
    }

    const body = {
      shift_date: shiftDate,
      start_time: startTime,
      end_time: endTime,
      role,
      required_staff,
      notes: notes.trim() || null,
    };

    const result = await run(() =>
      isNew
        ? apiFetch('/api/shifts', { token, method: 'POST', body })
        : apiFetch(`/api/shifts/${shift.id}`, { token, method: 'PATCH', body })
    );

    // Stay open on the newly created shift rather than closing: assigning someone is almost
    // always the next thing the manager wants, and that needs a saved shift to attach to.
    if (result) onSaved(result);
  }

  const assign = (user_id) =>
    run(() =>
      apiFetch(`/api/shifts/${shift.id}/assignments`, { token, method: 'POST', body: { user_id } })
    ).then((result) => {
      if (result) {
        onSaved(result);
        setAssignee('');
      }
    });

  const unassign = (userId) =>
    run(() =>
      apiFetch(`/api/shifts/${shift.id}/assignments/${userId}`, { token, method: 'DELETE' })
    ).then((result) => result && onSaved(result));

  // Not routed through run(): a 204 returns null, which run() cannot tell apart from failure.
  async function handleDelete() {
    setError('');
    setBusy(true);
    try {
      await apiFetch(`/api/shifts/${shift.id}`, { token, method: 'DELETE' });
      onDeleted();
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      else setError(err.message);
      setBusy(false);
    }
  }

  const assigned = shift?.assignments ?? [];
  const assignedIds = new Set(assigned.map((a) => a.user_id));
  const available = staff.filter((u) => !assignedIds.has(u.id));
  const overnight = endTime <= startTime;
  const short = !isNew && assigned.length < shift.required_staff;

  /*
   * A shift can be stored under a role that has since been retired — 'bartender' rows outlived
   * the role being dropped from SHIFT_ROLES. Without its own option the select falls back to
   * the first entry, so the dialog would claim the shift is a server shift and Save would
   * quietly rewrite it. Showing the real value instead means the API rejects the save until
   * someone picks a current role, which is a decision a manager should make deliberately.
   */
  const retiredRole = !SHIFT_ROLES.includes(role) ? role : null;

  return (
    <dialog
      ref={dialogRef}
      className="event"
      aria-label={isNew ? 'New shift' : `Edit ${shift.role} shift`}
    >
      <form className="event__form" onSubmit={handleSubmit}>
        <header className="event__bar">
          {/* Same exit as Escape: hand it to React and let the element be unmounted. */}
          <button type="button" className="event__icon-button" onClick={onClose} aria-label="Close">
            <CloseIcon className="event__glyph" />
          </button>

          <div className="event__bar-actions">
            {!isNew && !confirmingDelete && (
              <button
                type="button"
                className="event__icon-button event__icon-button--danger"
                onClick={() => setConfirmingDelete(true)}
                aria-label="Delete shift"
                title="Delete shift"
              >
                <TrashIcon className="event__glyph" />
              </button>
            )}
            <button type="submit" className="event__save" disabled={busy}>
              Save
            </button>
          </div>
        </header>

        {error && (
          <p role="alert" className="form-error event__error">
            {error}
          </p>
        )}

        {/* Two-step delete rather than window.confirm: a native dialog blocks the page thread,
            and there is no undo here the way a calendar app has one. */}
        {confirmingDelete && (
          <div className="event__confirm" role="group" aria-label="Confirm delete">
            <p>Delete this shift? Everyone assigned is notified that it was cancelled.</p>
            <div className="event__confirm-actions">
              <button type="button" className="button--danger-text" onClick={handleDelete} disabled={busy}>
                Delete shift
              </button>
              <button type="button" className="button--ghost" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}

        {/* The title line: what this shift *is*, biggest thing in the dialog. */}
        <div className="event__title">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Role"
            className="event__title-select"
          >
            {retiredRole && (
              <option value={retiredRole}>{retiredRole} (retired)</option>
            )}
            {SHIFT_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {/* <span className="event__title-caption">shift</span> */}
        </div>

        {retiredRole && (
          <p className="event__muted event__retired">
            <strong>{retiredRole}</strong> is no longer a role the kitchen staffs. Pick a current
            one to save any change to this shift.
          </p>
        )}

        {/* When: date and both times on one line, the way an event reads. */}
        <div className="event__row">
          <ClockIcon className="event__row-icon" />
          <div className="event__row-body">
            <div className="event__when">
              <input
                type="date"
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
                aria-label="Date"
                required
              />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                aria-label="Start time"
                required
              />
              <span className="event__dash" aria-hidden="true">
                –
              </span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                aria-label="End time"
                required
              />
            </div>

            <p className="event__when-note">
              {formatLongDay(shiftDate)}
              {/* Not a mistake to correct: it is how a closing shift is expressed. */}
              {overnight && ' · ends the next morning'}
            </p>
          </div>
        </div>

        {/* Who: the guest list, which for a shift is the roster. */}
        <div className="event__row">
          <PeopleIcon className="event__row-icon" />
          <div className="event__row-body">
            {isNew ? (
              <p className="event__muted">Save the shift first, then add people to it.</p>
            ) : (
              <>
                <p className="event__row-head">
                  {assigned.length} of {shift.required_staff} assigned
                  {short && <span className="badge badge--special">Short</span>}
                </p>

                {assigned.length > 0 && (
                  <ul className="event__guests">
                    {assigned.map((a) => (
                      <li key={a.user_id}>
                        <span className="event__avatar" aria-hidden="true">
                          {initials(a.full_name)}
                        </span>
                        <span className="event__guest-name">{a.full_name}</span>
                        <button
                          type="button"
                          className="event__icon-button event__guest-remove"
                          onClick={() => unassign(a.user_id)}
                          disabled={busy}
                          aria-label={`Remove ${a.full_name}`}
                          title={`Remove ${a.full_name}`}
                        >
                          <CloseIcon className="event__glyph event__glyph--small" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="event__add-guest">
                  <select
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    disabled={available.length === 0}
                    aria-label="Add someone to this shift"
                  >
                    <option value="">
                      {available.length === 0 ? 'Everyone is already on' : 'Add someone...'}
                    </option>
                    {available.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button--ghost"
                    onClick={() => assign(Number(assignee))}
                    disabled={busy || !assignee}
                  >
                    Add
                  </button>
                </div>

                {/* <p className="event__muted">
                  Someone already working an overlapping shift is refused, with the clash named.
                </p> */}
              </>
            )}
          </div>
        </div>

        {/* How many, and anything else worth saying. */}
        <div className="event__row">
          <NoteIcon className="event__row-icon" />
          <div className="event__row-body">
            <label className="event__inline-label" htmlFor="sh-required">
              Staff needed
            </label>
            <input
              id="sh-required"
              type="number"
              min="1"
              className="event__number"
              value={requiredStaff}
              onChange={(e) => setRequiredStaff(e.target.value)}
              required
            />

            <textarea
              className="event__notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note for whoever is on"
              aria-label="Notes"
            />
          </div>
        </div>
      </form>
    </dialog>
  );
}

export default ShiftEditor;

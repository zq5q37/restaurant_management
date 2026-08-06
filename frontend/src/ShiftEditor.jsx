import { useState } from 'react';
import { apiFetch } from './api';
import { timeOf } from './dates';

// Mirrors SHIFT_ROLES in backend/schedule/store.js — anything else is a 400 from the API.
const SHIFT_ROLES = ['server', 'host', 'cleaner', 'cook'];

/**
 * Create or edit one shift, and manage who is on it.
 *
 * Assignments only appear when editing an existing shift: they need a shift id, and the
 * conflict check the API runs on assignment has nothing to compare against until the shift
 * has real times stored.
 */
function ShiftEditor({ token, shift, staff, defaultDate, onClose, onSaved, onDeleted, onUnauthorized }) {
  const isNew = !shift;

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

  return (
    <div className="editor">
      <div className="editor__header">
        <h2>{isNew ? 'New shift' : `Edit ${shift.role} shift — ${shift.shift_date}`}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {error && (
        <p role="alert" className="schedule-error">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="editor__section">
        <h3>Details</h3>

        <label htmlFor="sh-date">Date</label>
        <input
          id="sh-date"
          type="date"
          value={shiftDate}
          onChange={(e) => setShiftDate(e.target.value)}
          required
        />

        <label htmlFor="sh-start">Starts</label>
        <input
          id="sh-start"
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
        />

        <label htmlFor="sh-end">Ends</label>
        <input
          id="sh-end"
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
        />
        {/* Not a mistake to correct: it is how a closing shift is expressed. */}
        {endTime <= startTime && (
          <p className="editor__hint">Ends the next day — an overnight shift.</p>
        )}

        <label htmlFor="sh-role">Role</label>
        <select id="sh-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {SHIFT_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label htmlFor="sh-required">Staff needed</label>
        <input
          id="sh-required"
          type="number"
          min="1"
          value={requiredStaff}
          onChange={(e) => setRequiredStaff(e.target.value)}
          required
        />

        <label htmlFor="sh-notes">Notes</label>
        <textarea id="sh-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <button type="submit" disabled={busy}>
          {isNew ? 'Create shift' : 'Save shift'}
        </button>
      </form>

      {!isNew && (
        <div className="editor__section">
          <h3>
            Assigned staff ({assigned.length}/{shift.required_staff})
          </h3>

          {assigned.length === 0 ? (
            <p className="editor__hint">Nobody assigned yet.</p>
          ) : (
            <ul className="schedule-assignees">
              {assigned.map((a) => (
                <li key={a.user_id}>
                  <span>{a.full_name}</span>
                  <button type="button" onClick={() => unassign(a.user_id)} disabled={busy}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label htmlFor="sh-assignee">Add someone</label>
          <select
            id="sh-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            disabled={available.length === 0}
          >
            <option value="">
              {available.length === 0 ? 'Everyone is already on this shift' : 'Choose a person...'}
            </option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.role})
              </option>
            ))}
          </select>

          <button type="button" onClick={() => assign(Number(assignee))} disabled={busy || !assignee}>
            Assign
          </button>

          <p className="editor__hint">
            Someone already working an overlapping shift is refused, with the clash named.
          </p>
        </div>
      )}

      {!isNew && (
        <div className="editor__section">
          <h3>Danger zone</h3>
          {/* Two-step delete rather than window.confirm: a native dialog blocks the page thread. */}
          {confirmingDelete ? (
            <div>
              <button type="button" onClick={handleDelete} disabled={busy}>
                Confirm delete
              </button>{' '}
              <button type="button" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)}>
              Delete shift
            </button>
          )}
          <p className="editor__hint">Everyone assigned is notified that it was cancelled.</p>
        </div>
      )}
    </div>
  );
}

export default ShiftEditor;

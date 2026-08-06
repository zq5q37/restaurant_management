import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from './api';
import './menu.css';
import './users.css';

// Mirrors ROLES in backend/routes/users.js.
const ROLES = ['customer', 'staff', 'manager', 'admin'];

/**
 * The Users page, straight off the Administration section of docs/permission-matrix.md:
 * managers may *list* users, but creating them, changing a role, deactivating and deleting
 * are admin-only. A manager therefore gets the same table with no controls on it.
 */
function Users({ token, user, onUnauthorized }) {
  const isAdmin = user.role === 'admin';

  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(null); // user id
  const [busyId, setBusyId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    apiFetch('/api/users', { token })
      .then((data) => {
        if (!cancelled) setUsers(data.users);
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
  }, [token, refreshKey, onUnauthorized]);

  const refresh = () => setRefreshKey((n) => n + 1);

  /** Every row action goes through here so one row's failure cannot be mistaken for another's. */
  async function mutate(id, fn, message) {
    setError('');
    setNotice('');
    setBusyId(id);
    try {
      await fn();
      setNotice(message);
      refresh();
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      // 409 is the self-lockout guard, or a duplicate email — the server's wording is clearer
      // than anything we could invent here.
      else setError(err.message);
    } finally {
      setBusyId(null);
      setConfirmingDelete(null);
    }
  }

  const changeRole = (row, role) =>
    mutate(
      row.id,
      () => apiFetch(`/api/users/${row.id}/role`, { token, method: 'PATCH', body: { role } }),
      `${row.full_name} is now ${role}.`
    );

  const setActive = (row, is_active) =>
    mutate(
      row.id,
      () => apiFetch(`/api/users/${row.id}/active`, { token, method: 'PATCH', body: { is_active } }),
      `${row.full_name} ${is_active ? 'reactivated' : 'deactivated'}.`
    );

  const deleteUser = (row) =>
    mutate(
      row.id,
      () => apiFetch(`/api/users/${row.id}`, { token, method: 'DELETE' }),
      `${row.full_name} deleted.`
    );

  // The list is small and comes down whole, so filtering here avoids a round trip per keystroke.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!needle ||
          u.full_name.toLowerCase().includes(needle) ||
          u.email.toLowerCase().includes(needle))
    );
  }, [users, query, roleFilter]);

  return (
    <div className="users">
      <div className="users-filters">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email..."
          aria-label="Search users"
        />

        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        {(query || roleFilter) && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setRoleFilter('');
            }}
          >
            Clear
          </button>
        )}

        {isAdmin && (
          <button type="button" onClick={() => setCreating((open) => !open)}>
            {creating ? 'Cancel' : '+ New user'}
          </button>
        )}
      </div>

      {isAdmin && creating && (
        <NewUser
          token={token}
          onCreated={(created) => {
            setCreating(false);
            setNotice(`${created.full_name} created as ${created.role}.`);
            refresh();
          }}
          onUnauthorized={onUnauthorized}
        />
      )}

      <p className="users-status" role="status">
        {loading
          ? 'Loading...'
          : `${visible.length} of ${users.length} user${users.length === 1 ? '' : 's'}`}
      </p>

      {error && (
        <p role="alert" className="users-error">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="users-notice">
          {notice}
        </p>
      )}

      {!isAdmin && (
        <p className="users-hint">
          You can view the list. Creating users, changing roles, deactivating and deleting are
          admin-only.
        </p>
      )}

      {!loading && visible.length === 0 && <p>No users match those filters.</p>}

      {visible.length > 0 && (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                {isAdmin && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const isSelf = row.id === user.id;

                return (
                  <tr key={row.id} className={row.is_active ? undefined : 'is-inactive'}>
                    <td>
                      {row.full_name}
                      {isSelf && <span className="users-chip">You</span>}
                    </td>
                    <td>{row.email}</td>

                    <td>
                      {isAdmin ? (
                        <select
                          value={row.role}
                          onChange={(e) => changeRole(row, e.target.value)}
                          // An admin demoting themselves could leave the system with no admin
                          // at all; the server returns 409, so the control is closed here too.
                          disabled={isSelf || busyId === row.id}
                          title={isSelf ? 'You cannot change your own role' : undefined}
                          aria-label={`Role for ${row.full_name}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.role
                      )}
                    </td>

                    <td>{row.is_active ? 'Active' : 'Deactivated'}</td>

                    {isAdmin && (
                      <td className="users-actions">
                        <button
                          type="button"
                          onClick={() => setActive(row, !row.is_active)}
                          disabled={isSelf || busyId === row.id}
                          title={isSelf ? 'You cannot deactivate your own account' : undefined}
                        >
                          {row.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>

                        {confirmingDelete === row.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => deleteUser(row)}
                              disabled={busyId === row.id}
                            >
                              Confirm delete
                            </button>
                            <button type="button" onClick={() => setConfirmingDelete(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(row.id)}
                            disabled={isSelf || busyId === row.id}
                            title={isSelf ? 'You cannot delete your own account' : undefined}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Admin-only: POST /api/users. Email is lowercased and the password hashed server-side. */
function NewUser({ token, onCreated, onUnauthorized }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('staff');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      const data = await apiFetch('/api/users', {
        token,
        method: 'POST',
        body: { email: email.trim(), password, full_name: fullName.trim(), role },
      });
      onCreated(data.user);
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      else setError(err.message); // 409 when the email is already taken
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="editor">
      <div className="editor__header">
        <h2>New user</h2>
      </div>

      {error && (
        <p role="alert" className="users-error">
          {error}
        </p>
      )}

      <div className="editor__section">
        <label htmlFor="nu-name">Name</label>
        <input id="nu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />

        <label htmlFor="nu-email">Email</label>
        <input
          id="nu-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          required
        />

        <label htmlFor="nu-role">Role</label>
        <select id="nu-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label htmlFor="nu-password">Temporary password</label>
        {/* minLength matches the rule PATCH /api/profile/password enforces, so a new account
            cannot start out with a password its owner would not be allowed to set. */}
        <input
          id="nu-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="editor__hint">
          At least 8 characters. The new user can change it from their own profile.
        </p>

        <button type="submit" disabled={busy}>
          {busy ? 'Creating...' : 'Create user'}
        </button>
      </div>
    </form>
  );
}

export default Users;

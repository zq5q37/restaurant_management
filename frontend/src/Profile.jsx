import { useState } from 'react';

function Profile({ token, user, onUpdated, onUnauthorized }) {
  const [fullName, setFullName] = useState(user.full_name);
  const [email, setEmail] = useState(user.email);
  const [status, setStatus] = useState(null); // { type: 'ok' | 'error', text }
  const [saving, setSaving] = useState(false);

  const dirty = fullName !== user.full_name || email !== user.email;

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus(null);
    setSaving(true);

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ full_name: fullName, email }),
      });

      // The token expired or the account was deactivated mid-session.
      if (res.status === 401) {
        onUnauthorized();
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        // e.g. 409 when the email already belongs to someone else.
        setStatus({ type: 'error', text: data.error || 'Could not save changes' });
        return;
      }

      onUpdated(data.user);
      setStatus({ type: 'ok', text: 'Profile saved' });
    } catch {
      setStatus({ type: 'error', text: 'Could not reach the server' });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setFullName(user.full_name);
    setEmail(user.email);
    setStatus(null);
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="full_name">Name</label>
        <input
          id="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="profile_email">Email</label>
        <input
          id="profile_email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
      </div>

      <p>
        Role: <strong>{user.role}</strong> &mdash; only an admin can change this.
      </p>

      <button type="submit" disabled={saving || !dirty}>
        {saving ? 'Saving...' : 'Save changes'}
      </button>{' '}
      <button type="button" onClick={handleReset} disabled={saving || !dirty}>
        Reset
      </button>

      {status && <p role={status.type === 'error' ? 'alert' : 'status'}>{status.text}</p>}
    </form>
  );
}

export default Profile;

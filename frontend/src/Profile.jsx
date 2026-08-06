import { useState } from 'react';
import PageHead from './PageHead';
import { PAGE_JP } from './labels';

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
    <div className="profile">
      <PageHead
        kicker={PAGE_JP.profile}
        title="Your details"
        sub="Your name and email. Your role is set for you by an admin."
      />

      <div className="page--padded">
        <div className="panel" style={{ maxWidth: '32rem' }}>
          <form onSubmit={handleSubmit} className="panel__section" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            <h2>Account</h2>

            <label htmlFor="full_name">Name</label>
            <input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />

            <label htmlFor="profile_email">Email</label>
            <input
              id="profile_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />

            <p className="hint">
              Signed in as <strong>{user.role}</strong> &mdash; only an admin can change this.
            </p>

            <div className="panel__actions">
              <button type="submit" disabled={saving || !dirty}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
              <button
                type="button"
                className="button--ghost"
                onClick={handleReset}
                disabled={saving || !dirty}
              >
                Reset
              </button>
            </div>

            {status && (
              <p
                role={status.type === 'error' ? 'alert' : 'status'}
                className={status.type === 'error' ? 'form-error' : 'notice'}
              >
                {status.text}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export default Profile;

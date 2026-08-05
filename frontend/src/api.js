/**
 * Thin wrapper over fetch: attaches the bearer token, parses JSON, and turns a non-2xx
 * response into a thrown Error carrying `.status` so callers can branch on 401 vs 409.
 */
export async function apiFetch(path, { token, body, ...options } = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

/** Cents to a display string. The API only ever speaks integers; rounding happens here, once. */
export function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

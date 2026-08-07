import { useEffect, useRef, useState } from 'react';
import { apiFetch, formatPrice } from './api';

/** The API speaks integer cents; humans type dollars. Convert at the edge, in one place. */
const centsToDollars = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

function dollarsToCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100);
}

/**
 * Create or edit one menu item, over the menu rather than shoved into it.
 *
 * A native <dialog> for the same reasons ShiftEditor.jsx uses one: focus is trapped in the
 * form, the menu behind goes inert, and the backdrop is a pseudo-element. Hand-rolling that is
 * a few hundred lines of focus management to get wrong.
 *
 * It does NOT close on a backdrop click, matching ShiftEditor. Both are forms holding typed
 * input, and losing a half-entered price to a stray click is worse than having to reach for
 * Escape or Close.
 */
function ItemEditor({ token, categories, item, onClose, onSaved, onUnauthorized }) {
  const isNew = !item;
  const dialogRef = useRef(null);

  const [categoryId, setCategoryId] = useState(item?.category_id ?? categories[0]?.id ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(centsToDollars(item?.price_cents));

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Held in a ref so the effect below can stay mount-only: Menu passes a new arrow function
  // every render, and depending on it would tear down and re-open the dialog mid-edit.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    // showModal(), not the `open` attribute — only the former is modal, and without it there is
    // no focus trap, no inert background and no Escape.
    if (!dialog.open) dialog.showModal();

    /*
     * Escape is handled here and the default prevented, so the browser cannot close the element
     * behind React's back. ShiftEditor.jsx documents the failure this avoids: a dialog the
     * browser closed sits at `open === false` while `editing` in Menu is still set, so clicking
     * Edit on the same dish changes no state, nothing re-renders, and the editor never returns.
     * Closing through React unmounts the element instead, which cannot get out of step.
     *
     * On `document`, NOT on the dialog — and that difference is load-bearing. A dialog-scoped
     * listener only sees the key while focus is inside the dialog, and focus can leave without
     * the user doing anything: a control that disables itself while a request is in flight has
     * focus taken from it and dropped on <body>. The browser still treats Escape as a close
     * request on the top-layer dialog, so the listener misses it and the desync above happens
     * anyway. Reproduced by saving and then pressing Escape.
     *
     * `dialog.open` keeps it a no-op when this dialog is not the one showing.
     */
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || !dialog.open) return;
      event.preventDefault();
      onCloseRef.current();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  /** Every request goes through here so 401 handling and error display are never forgotten. */
  async function run(fn) {
    setError('');
    setBusy(true);
    try {
      const result = await fn();
      onSaved(result);
      return true;
    } catch (err) {
      if (err.status === 401) {
        onUnauthorized();
        return false;
      }
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleDetailsSubmit(event) {
    event.preventDefault();
    // The guard that `aria-disabled` cannot enforce on its own — see the Save button below.
    if (busy) return;

    const price_cents = dollarsToCents(price);
    if (isNew && price_cents === null) {
      setError('Price must be a number like 12.50');
      return;
    }

    const saved = await run(() =>
      isNew
        ? apiFetch('/api/menu-items', {
            token,
            method: 'POST',
            body: {
              category_id: Number(categoryId),
              name,
              description: description || null,
              price_cents,
            },
          })
        : apiFetch(`/api/menu-items/${item.id}`, {
            token,
            method: 'PATCH',
            body: { category_id: Number(categoryId), name, description: description || null },
          })
    );

    if (saved && isNew) onClose();
  }

  return (
    /* The inner .panel stays the scroll container and keeps every descendant rule it already
       had; the dialog only supplies the frame. See .item-dialog in menu.css. */
    <dialog className="item-dialog" ref={dialogRef} aria-labelledby="ed-title">
      <div className="panel">
        <div className="panel__head">
          <h2 id="ed-title">{isNew ? 'New menu item' : `Edit: ${item.name}`}</h2>
          <button type="button" onClick={onClose} className="button--ghost">
            Close
          </button>
        </div>

        {error && <p role="alert" className="form-error">{error}</p>}

        <form onSubmit={handleDetailsSubmit} className="panel__section">
          <h3>Details</h3>

          <label htmlFor="ed-category">Category</label>
          <select
            id="ed-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label htmlFor="ed-name">Name</label>
          <input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} required />

          <label htmlFor="ed-description">Description</label>
          <textarea
            id="ed-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {/* Base price is only set here on create; afterwards it belongs to the pricing section. */}
          {isNew && (
            <>
              <label htmlFor="ed-price">Price ($)</label>
              <input
                id="ed-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="12.50"
                required
              />
            </>
          )}

          {/*
            aria-disabled, not disabled. This button is focused at the moment it is pressed, and
            a focused element that becomes `disabled` has focus taken from it and dropped on
            <body> — so saving would throw a keyboard user out of the dialog to the top of the
            document. The guard in handleDetailsSubmit does the blocking instead.
          */}
          <button type="submit" aria-disabled={busy}>
            {isNew ? 'Create item' : 'Save details'}
          </button>
        </form>

        {!isNew && (
          <>
            <PricingSection token={token} item={item} run={run} />
            <ImageSection token={token} item={item} run={run} />
          </>
        )}
      </div>
    </dialog>
  );
}

function PricingSection({ token, item, run }) {
  const [price, setPrice] = useState(centsToDollars(item.price_cents));
  const [cost, setCost] = useState(centsToDollars(item.cost_cents));
  const [mode, setMode] = useState(
    item.special_price_cents != null ? 'special' : item.discount_percent != null ? 'discount' : 'none'
  );
  const [specialPrice, setSpecialPrice] = useState(centsToDollars(item.special_price_cents));
  const [discount, setDiscount] = useState(item.discount_percent ?? '');
  const [startsAt, setStartsAt] = useState(item.special_starts_at ?? '');
  const [endsAt, setEndsAt] = useState(item.special_ends_at ?? '');

  function handleSubmit(event) {
    event.preventDefault();

    // The API rejects setting both, so clearing the unused one is required, not optional.
    const body = {
      price_cents: dollarsToCents(price),
      // Blank means "unknown", which keeps the item out of margin reporting. Sending 0
      // instead would report it as pure profit.
      cost_cents: cost.trim() === '' ? null : dollarsToCents(cost),
      special_price_cents: mode === 'special' ? dollarsToCents(specialPrice) : null,
      discount_percent: mode === 'discount' ? Number(discount) : null,
      special_starts_at: mode === 'none' ? null : startsAt || null,
      special_ends_at: mode === 'none' ? null : endsAt || null,
    };

    run(() => apiFetch(`/api/menu-items/${item.id}/pricing`, { token, method: 'PATCH', body }));
  }

  return (
    <form onSubmit={handleSubmit} className="panel__section">
      <h3>Pricing</h3>

      <label htmlFor="pr-base">Base price ($)</label>
      <input id="pr-base" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />

      <label htmlFor="pr-cost">Cost ($)</label>
      <input
        id="pr-cost"
        inputMode="decimal"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        placeholder="4.20"
      />
      <p className="hint">
        What the ingredients cost. Drives margin reporting in Analytics; leave blank if unknown.
      </p>

      <fieldset className="panel__modes">
        <legend>Special</legend>
        {[
          ['none', 'No special'],
          ['special', 'Fixed special price'],
          ['discount', 'Percentage off'],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name={`mode-${item.id}`}
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />{' '}
            {label}
          </label>
        ))}
      </fieldset>

      {mode === 'special' && (
        <>
          <label htmlFor="pr-special">Special price ($)</label>
          <input
            id="pr-special"
            inputMode="decimal"
            value={specialPrice}
            onChange={(e) => setSpecialPrice(e.target.value)}
          />
        </>
      )}

      {mode === 'discount' && (
        <>
          <label htmlFor="pr-discount">Discount (1&ndash;99%)</label>
          <input
            id="pr-discount"
            type="number"
            min="1"
            max="99"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </>
      )}

      {mode !== 'none' && (
        <>
          <label htmlFor="pr-start">Starts (optional, YYYY-MM-DD HH:MM:SS)</label>
          <input
            id="pr-start"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            placeholder="2026-08-10 00:00:00"
          />
          <label htmlFor="pr-end">Ends (optional)</label>
          <input
            id="pr-end"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            placeholder="2026-08-20 23:59:59"
          />
        </>
      )}

      <p className="hint">
        Currently charging <strong>{formatPrice(item.effective_price_cents)}</strong>
        {item.is_on_special ? ' (special active)' : ''}
      </p>

      <button type="submit">Save pricing</button>
    </form>
  );
}

function ImageSection({ token, item, run }) {
  const [file, setFile] = useState(null);

  function handleUpload(event) {
    event.preventDefault();
    if (!file) return;

    const data = new FormData();
    data.append('image', file);

    // No Content-Type header here on purpose: the browser must set it, because only it knows
    // the multipart boundary string. Setting it manually produces an unparseable request.
    run(async () => {
      const res = await fetch(`/api/menu-items/${item.id}/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: data,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json.error || 'Upload failed');
        err.status = res.status;
        throw err;
      }
      return json;
    }).then(() => setFile(null));
  }

  return (
    <form onSubmit={handleUpload} className="panel__section">
      <h3>Image</h3>

      {item.image_path ? (
        <img className="panel__thumb" src={`/api/images/${item.image_path}`} alt={item.name} />
      ) : (
        <p className="hint">No image yet.</p>
      )}

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => setFile(e.target.files[0] ?? null)}
      />
      <p className="hint">JPEG, PNG or WebP, up to 2 MB.</p>

      <div>
        <button type="submit" disabled={!file}>
          Upload
        </button>{' '}
        {item.image_path && (
          <button
            type="button"
            onClick={() =>
              run(() => apiFetch(`/api/menu-items/${item.id}/image`, { token, method: 'DELETE' }))
            }
          >
            Remove image
          </button>
        )}
      </div>
    </form>
  );
}

export default ItemEditor;

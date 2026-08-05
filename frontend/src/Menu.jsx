import { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatPrice } from './api';
import ItemEditor from './ItemEditor';
import './menu.css';

const SORTS = [
  { value: '', label: 'Menu order' },
  { value: 'name', label: 'Name' },
  { value: 'price', label: 'Price' },
  { value: 'newest', label: 'Newest' },
];

function Menu({ token, user, onUnauthorized }) {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [availability, setAvailability] = useState('');
  const [sort, setSort] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // `editing` is null (closed), 'new', or the item being edited. `refreshKey` re-runs the
  // list query after any mutation so the grid never drifts from the server.
  const [editing, setEditing] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Customers only ever receive available items, so the filter would be a no-op for them.
  const canFilterAvailability = user.role !== 'customer';
  const canManage = user.role === 'manager' || user.role === 'admin';

  // Wait for a pause in typing rather than firing a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    apiFetch('/api/categories', { token })
      .then((data) => setCategories(data.categories))
      .catch(() => setCategories([]));
  }, [token, refreshKey]);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    if (categoryId) params.set('category_id', categoryId);
    if (availability) params.set('available', availability);
    if (sort) params.set('sort', sort);

    // Responses can arrive out of order; ignore any that is no longer the current request.
    let cancelled = false;
    setLoading(true);
    setError('');

    apiFetch(`/api/menu-items?${params}`, { token })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
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
  }, [token, debouncedQuery, categoryId, availability, sort, refreshKey, onUnauthorized]);

  const refresh = () => setRefreshKey((n) => n + 1);

  /** Keeps the open editor pointed at the freshly saved row rather than a stale copy. */
  function handleSaved(result) {
    refresh();
    if (result?.item) setEditing((current) => (current && current !== 'new' ? result.item : current));
  }

  async function mutate(fn) {
    try {
      await fn();
      refresh();
    } catch (err) {
      if (err.status === 401) return onUnauthorized();
      setError(err.message);
    }
  }

  const toggleAvailability = (item) =>
    mutate(() =>
      apiFetch(`/api/menu-items/${item.id}/availability`, {
        token,
        method: 'PATCH',
        body: { is_available: !item.is_available },
      })
    );

  const deleteItem = (item) =>
    mutate(() => apiFetch(`/api/menu-items/${item.id}`, { token, method: 'DELETE' }));

  // In menu order the API already groups by category, so headings read naturally. Under an
  // explicit sort the order is global, and grouping would splinter into repeated headings.
  const grouped = useMemo(() => {
    if (sort) return null;
    return items.reduce((acc, item) => {
      (acc[item.category_name] ||= []).push(item);
      return acc;
    }, {});
  }, [items, sort]);

  const hasFilters = Boolean(query || categoryId || availability || sort);

  function clearFilters() {
    setQuery('');
    setCategoryId('');
    setAvailability('');
    setSort('');
  }

  const gridProps = {
    canManage,
    onEdit: setEditing,
    onToggle: toggleAvailability,
    onDelete: deleteItem,
  };

  return (
    <div className="menu">
      <div className="menu-filters">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search dishes..."
          aria-label="Search menu"
        />

        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.item_count})
            </option>
          ))}
        </select>

        {canFilterAvailability && (
          <select value={availability} onChange={(e) => setAvailability(e.target.value)} aria-label="Availability">
            <option value="">Any availability</option>
            <option value="true">Available only</option>
            <option value="false">Unavailable only</option>
          </select>
        )}

        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Sort: {s.label}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button type="button" onClick={clearFilters}>
            Clear
          </button>
        )}

        {canManage && (
          <button type="button" onClick={() => setEditing('new')}>
            + New item
          </button>
        )}
      </div>

      {canManage && editing && (
        <ItemEditor
          token={token}
          categories={categories}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
          onUnauthorized={onUnauthorized}
        />
      )}

      <p className="menu-status" role="status">
        {loading ? 'Loading...' : `${total} item${total === 1 ? '' : 's'}`}
      </p>

      {error && <p role="alert" className="menu-error">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p>No dishes match those filters.</p>
      )}

      {grouped
        ? Object.entries(grouped).map(([categoryName, categoryItems]) => (
            <section key={categoryName}>
              <h2>{categoryName}</h2>
              <ItemGrid items={categoryItems} {...gridProps} />
            </section>
          ))
        : items.length > 0 && <ItemGrid items={items} {...gridProps} />}
    </div>
  );
}

function ItemGrid({ items, canManage, onEdit, onToggle, onDelete }) {
  return (
    <ul className="menu-grid">
      {items.map((item) => (
        <MenuCard
          key={item.id}
          item={item}
          canManage={canManage}
          onEdit={onEdit}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

function MenuCard({ item, canManage, onEdit, onToggle, onDelete }) {
  // Two-step delete instead of window.confirm: a native dialog blocks the page thread.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <li className={`menu-card${item.is_available ? '' : ' menu-card--unavailable'}`}>
      {item.image_path ? (
        <img
          className="menu-card__image"
          src={`/api/images/${item.image_path}`}
          alt={item.name}
          loading="lazy"
        />
      ) : (
        <div className="menu-card__image menu-card__image--empty" aria-hidden="true" />
      )}

      <div className="menu-card__body">
        <h3>{item.name}</h3>
        {item.description && <p className="menu-card__description">{item.description}</p>}

        <p className="menu-card__price">
          {item.is_on_special ? (
            <>
              <s>{formatPrice(item.price_cents)}</s>{' '}
              <strong>{formatPrice(item.effective_price_cents)}</strong>{' '}
              <span className="menu-badge menu-badge--special">Special</span>
            </>
          ) : (
            <strong>{formatPrice(item.price_cents)}</strong>
          )}
        </p>

        {!item.is_available && (
          <span className="menu-badge menu-badge--unavailable">Unavailable</span>
        )}

        {canManage && (
          <div className="menu-card__actions">
            <button type="button" onClick={() => onEdit(item)}>
              Edit
            </button>
            <button type="button" onClick={() => onToggle(item)}>
              {item.is_available ? 'Mark unavailable' : 'Mark available'}
            </button>

            {confirmingDelete ? (
              <>
                <button type="button" onClick={() => onDelete(item)}>
                  Confirm delete
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmingDelete(true)}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default Menu;

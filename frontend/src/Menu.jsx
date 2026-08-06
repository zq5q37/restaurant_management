import { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatPrice } from './api';
import ItemEditor from './ItemEditor';
import PageHead from './PageHead';
import { CATEGORY_JP, DISH_JP, PAGE_JP } from './labels';
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
  const [openId, setOpenId] = useState(null);

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

  /**
   * Opening a dish fetches it by id. That request is what records the view behind the
   * "popular items" report — the list endpoint deliberately does not count, because
   * appearing in a grid of everything is not the same as someone looking at you.
   */
  function openItem(item) {
    setOpenId((current) => (current === item.id ? null : item.id));
    apiFetch(`/api/menu-items/${item.id}`, { token }).catch(() => {
      /* The card already has everything it displays; a failed ping is not worth an alert. */
    });
  }

  const gridProps = {
    canManage,
    onEdit: setEditing,
    onToggle: toggleAvailability,
    onDelete: deleteItem,
    onOpen: openItem,
    openId,
  };

  return (
    <div className="menu">
      <PageHead
        kicker={PAGE_JP.menu}
        title="Tonight's menu"
        sub={
          canManage
            ? 'Everything the kitchen is serving. Prices, photography and availability are edited here.'
            : 'Everything the kitchen is serving tonight.'
        }
        sideValue={loading ? '—' : total}
        sideLabel={total === 1 ? 'dish' : 'dishes'}
      />

      <div className="filter-bar">
        <div className="filter-bar__group">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes..."
            aria-label="Search menu"
          />

          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
            <option value="">All courses</option>
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
              <option value="false">Off the menu</option>
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
            <button type="button" className="button--ghost" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>

        {canManage && (
          <button type="button" onClick={() => setEditing('new')}>
            + New dish
          </button>
        )}
      </div>

      {canManage && editing && (
        <div className="page--padded">
          <ItemEditor
            token={token}
            categories={categories}
            item={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
            onUnauthorized={onUnauthorized}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="form-error page--padded">
          {error}
        </p>
      )}

      {loading && <p className="menu-status" role="status">Loading...</p>}

      {!loading && !error && items.length === 0 && (
        <p className="menu-empty">No dishes match those filters.</p>
      )}

      {grouped
        ? Object.entries(grouped).map(([categoryName, categoryItems]) => (
            <Course key={categoryName} name={categoryName} items={categoryItems}>
              <ItemGrid items={categoryItems} {...gridProps} />
            </Course>
          ))
        : items.length > 0 && (
            <Course name="Results" items={items} sorted>
              <ItemGrid items={items} {...gridProps} />
            </Course>
          )}
    </div>
  );
}

/**
 * One course of the menu: its lantern in the left margin, its dishes across the band.
 *
 * The band lights up when something in it is on special — the same signal a shop gives by
 * putting a lit sign outside the thing it wants you to notice.
 */
function Course({ name, items, sorted, children }) {
  const lit = items.some((item) => item.is_on_special);
  const jp = CATEGORY_JP[name];

  return (
    <section className={`course${lit ? ' course--lit' : ''}`}>
      <div className="course__name">
        <span className="lantern">
          {jp && (
            <span className="lantern__jp" lang="ja">
              {jp}
            </span>
          )}
          <span className="lantern__en">{name}</span>
        </span>

        <span className="course__count">
          {items.length} {items.length === 1 ? 'dish' : 'dishes'}
          {sorted ? ' · sorted' : ''}
        </span>
      </div>

      {children}
    </section>
  );
}

function ItemGrid({ items, canManage, onEdit, onToggle, onDelete, onOpen, openId }) {
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
          onOpen={onOpen}
          isOpen={openId === item.id}
        />
      ))}
    </ul>
  );
}

function MenuCard({ item, canManage, onEdit, onToggle, onDelete, onOpen, isOpen }) {
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
        {/* Opening a dish is what "popular" counts, so the title is the thing you click. */}
        <h3>
          <button type="button" className="menu-card__open" onClick={() => onOpen(item)} aria-expanded={isOpen}>
            {item.name}
          </button>
        </h3>

        {/* The dish's Japanese name under its English one. Absent for anything not in
            labels.js, which is the intended behaviour for dishes added through the editor. */}
        {DISH_JP[item.name] && (
          <p className="menu-card__jp" lang="ja">
            {DISH_JP[item.name]}
          </p>
        )}

        {item.description && <p className="menu-card__description">{item.description}</p>}

        <p className="menu-card__price">
          {item.is_on_special ? (
            <>
              <s>{formatPrice(item.price_cents)}</s>
              <strong>{formatPrice(item.effective_price_cents)}</strong>
              <span className="badge badge--special">Special</span>
            </>
          ) : (
            <strong>{formatPrice(item.price_cents)}</strong>
          )}

          {/* The lamp badge, not colour alone: "off the menu" is also carried by the word
              and by the greyed photograph above it. */}
          {!item.is_available && <span className="badge badge--muted">Off the menu</span>}
        </p>

        {isOpen && (
          <dl className="menu-card__details">
            <dt>Category</dt>
            <dd>{item.category_name}</dd>
            <dt>Price</dt>
            <dd>
              {formatPrice(item.effective_price_cents)}
              {item.is_on_special && ` (was ${formatPrice(item.price_cents)})`}
            </dd>
          </dl>
        )}

        {canManage && (
          <div className="menu-card__actions">
            <button type="button" className="button--ghost" onClick={() => onEdit(item)}>
              Edit
            </button>
            <button type="button" className="button--ghost" onClick={() => onToggle(item)}>
              {item.is_available ? 'Take off menu' : 'Put back on'}
            </button>

            {confirmingDelete ? (
              <>
                <button type="button" className="button--danger-text" onClick={() => onDelete(item)}>
                  Confirm delete
                </button>
                <button type="button" className="button--ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="button--danger-text" onClick={() => setConfirmingDelete(true)}>
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

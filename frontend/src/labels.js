/**
 * Japanese labels, kept on the client on purpose.
 *
 * These are presentation, not data: the database stores one canonical English name per
 * category, which is what search, the CSV exports and the manager screens all work against.
 * Putting the Japanese in the `name` column instead would push it into every export and
 * every admin form for the sake of one label.
 *
 * A category with no entry here simply renders without a Japanese line, so anything a
 * manager adds still works — it just is not captioned until someone adds it below.
 */

/** Keyed by the exact category name. */
export const CATEGORY_JP = {
  Appetizers: '前菜',
  Mains: '主菜',
  Desserts: '甘味',
  Beverages: '飲み物',
};

/** Per-screen kickers for the page header band. */
export const PAGE_JP = {
  menu: 'お品書き',
  schedule: '勤務表',
  analytics: '報告',
  users: '名簿',
  profile: '自分',
};

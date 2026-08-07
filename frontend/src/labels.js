/**
 * Japanese labels for the menu, kept on the client on purpose.
 *
 * These are presentation, not data: the database stores one canonical English name per
 * category and dish, which is what search, the CSV exports and the manager screens all work
 * against. Putting the Japanese in the `name` column instead would push it into every export
 * and every admin form for the sake of one label.
 *
 * A dish or category with no entry here simply renders without its Japanese line, so anything
 * added through the menu editor still works — it just is not captioned until someone adds it
 * below. The proper home for this eventually is a translations table; this is the honest
 * short version until that endpoint exists.
 */

/** Keyed by the exact category name. */
export const CATEGORY_JP = {
  'Small Plates': '小皿',
  'Noodles & Rice': '麺と飯',
  'From the Pot': '鍋物',
  'Air Fryer': '揚げ物',
};

/** Keyed by the exact dish name. */
export const DISH_JP = {
  'Sesame Sauce Salad': '胡麻和え',
  'Sardine Ochazuke': '鰯茶漬け',
  'Japanese Curry Rice': 'カレーライス',
  'Japanese Curry Udon': 'カレーうどん',
  'Tofu Udon': '豆腐うどん',
  Sukiyaki: 'すき焼き',
  'Napa Cabbage, Enoki and Pork Soup': '白菜と豚の鍋',
  'Air-fried Chicken': '唐揚げ',
  'Air-fried Potato Wedges': 'ポテトウェッジ',
};

/**
 * The capsule machine on the menu page. 一品 is "one dish"; ガチャ is the machine itself, from
 * the sound the crank makes — the Japanese name for the thing, not a translation of ours.
 */
export const GACHA_JP = { title: '一品ガチャ' };

/** Per-screen kickers for the page header band. */
export const PAGE_JP = {
  menu: 'お品書き',
  schedule: '勤務表',
  analytics: '報告',
  users: '名簿',
  profile: '自分',
};

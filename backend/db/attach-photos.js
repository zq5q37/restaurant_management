/**
 * Attach the seed dish photographs to their menu items.
 *
 * Separate from `seed.js` because the two write to different places: the seed writes rows to
 * the database, this copies files into UPLOAD_DIR, which is its own Docker volume. Wiping
 * either one alone leaves the other stale, so re-running this after a `down -v` is what puts
 * the photographs back.
 *
 *   node db/attach-photos.js
 *   docker compose exec backend node db/attach-photos.js
 *
 * Does not go through POST /api/menu-items/:id/image: that endpoint needs a bearer token and
 * a running server, and this has to work against a cold database. The file naming convention
 * is the same one the upload middleware uses, so images served from /api/images work either
 * way.
 *
 * Idempotent, and deliberately conservative: an item that already has an image is left alone,
 * so a photograph uploaded through the menu editor is never overwritten by the seed's.
 * Pass --force to replace them anyway.
 *
 * Sources and licences: backend/seed-assets/dishes/ATTRIBUTION.md
 */
const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('./index');
const { UPLOAD_DIR } = require('../middleware/upload');

const SOURCE_DIR = path.join(__dirname, '..', 'seed-assets', 'dishes');
const force = process.argv.includes('--force');

/** Exact dish name -> the staged file. A dish not listed here simply keeps its empty slot. */
const PHOTOS = {
  'Sesame Sauce Salad': 'sesame-salad.jpg',
  'Sardine Ochazuke': 'ochazuke.jpg',
  'Japanese Curry Rice': 'curry-rice.jpg',
  'Japanese Curry Udon': 'curry-udon.jpg',
  'Tofu Udon': 'tofu-udon.jpg',
  Sukiyaki: 'sukiyaki.jpg',
  'Napa Cabbage, Enoki and Pork Soup': 'nabe.jpg',
  'Air-fried Chicken': 'karaage.jpg',
  'Air-fried Potato Wedges': 'potato-wedges.jpg',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const findItem = db.prepare('SELECT id, name, image_path FROM menu_items WHERE name = ?');
const setImage = db.prepare(
  "UPDATE menu_items SET image_path = ?, updated_at = datetime('now') WHERE id = ?"
);

let attached = 0;
let skipped = 0;
let missing = 0;

for (const [name, file] of Object.entries(PHOTOS)) {
  const item = findItem.get(name);
  if (!item) {
    console.warn(`  no menu item named "${name}" — skipped`);
    missing += 1;
    continue;
  }

  if (item.image_path && !force) {
    skipped += 1;
    continue;
  }

  const source = path.join(SOURCE_DIR, file);
  if (!fs.existsSync(source)) {
    console.warn(`  missing source file ${file} — skipped`);
    missing += 1;
    continue;
  }

  // A stable filename rather than a UUID: re-running must not litter the volume with an
  // extra copy each time. These are seed assets, not user uploads, so they are not secret.
  const stored = `seed-${file}`;
  fs.copyFileSync(source, path.join(UPLOAD_DIR, stored));
  setImage.run(stored, item.id);
  attached += 1;
}

console.log(`Database: ${DB_PATH}`);
console.log(`Uploads:  ${UPLOAD_DIR}`);
console.log(
  `Attached ${attached} photo(s)` +
    (skipped ? `; left ${skipped} item(s) that already had one (use --force to replace)` : '') +
    (missing ? `; ${missing} could not be matched` : '')
);

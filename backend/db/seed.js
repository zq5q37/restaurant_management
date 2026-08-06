const bcrypt = require('bcrypt');
const { db, migrate, DB_PATH } = require('./index');

// Dev convenience: one known password for every seeded account. Override with SEED_PASSWORD.
// These accounts are for local development only — never seed them into a deployed database.
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Passw0rd!23';
const BCRYPT_ROUNDS = 10;

const SEED_USERS = [
  { email: 'customer@example.com', full_name: 'Casey Customer', role: 'customer' },
  { email: 'staff@example.com', full_name: 'Sam Staff', role: 'staff' },
  { email: 'manager@example.com', full_name: 'Morgan Manager', role: 'manager' },
  { email: 'admin@example.com', full_name: 'Alex Admin', role: 'admin' },
];

migrate();

const insert = db.prepare(`
  INSERT INTO users (email, password_hash, full_name, role)
  VALUES (@email, @password_hash, @full_name, @role)
  ON CONFLICT (email) DO NOTHING
`);

// One transaction: either every seed user lands or none does.
const seedAll = db.transaction((users) => {
  let created = 0;
  for (const user of users) {
    const password_hash = bcrypt.hashSync(SEED_PASSWORD, BCRYPT_ROUNDS);
    if (insert.run({ ...user, password_hash }).changes > 0) created++;
  }
  return created;
});

const created = seedAll(SEED_USERS);

// --- Menu ------------------------------------------------------------------

const SEED_CATEGORIES = [
  { name: 'Appetizers', description: 'Small plates to start', display_order: 1 },
  { name: 'Mains', description: 'Main courses', display_order: 2 },
  { name: 'Desserts', description: 'Something sweet', display_order: 3 },
  { name: 'Beverages', description: 'Drinks, hot and cold', display_order: 4 },
];

// price_cents, never dollars — see the note in schema.sql.
const SEED_ITEMS = [
  ['Appetizers', 'Garlic Bread', 'Toasted sourdough with garlic butter', 650, 1],
  ['Appetizers', 'Soup of the Day', 'Ask your server', 780, 1],
  ['Mains', 'Margherita Pizza', 'Tomato, mozzarella, basil', 1450, 1],
  ['Mains', 'Grilled Salmon', 'With seasonal vegetables', 2200, 1],
  ['Mains', 'Mushroom Risotto', 'Arborio rice, wild mushrooms', 1680, 0],
  ['Desserts', 'Tiramisu', 'Espresso-soaked ladyfingers', 890, 1],
  ['Desserts', 'Lemon Tart', 'With raspberry coulis', 820, 1],
  ['Beverages', 'Espresso', 'Single shot', 320, 1],
  ['Beverages', 'Fresh Orange Juice', 'Squeezed to order', 480, 1],
];

const insertCategory = db.prepare(`
  INSERT INTO categories (name, description, display_order)
  VALUES (@name, @description, @display_order)
  ON CONFLICT (name) DO NOTHING
`);

const insertItem = db.prepare(`
  INSERT INTO menu_items (category_id, name, description, price_cents, is_available)
  VALUES (@category_id, @name, @description, @price_cents, @is_available)
  ON CONFLICT (category_id, name) DO NOTHING
`);

const seedMenu = db.transaction(() => {
  let categories = 0;
  let items = 0;

  for (const category of SEED_CATEGORIES) {
    if (insertCategory.run(category).changes > 0) categories++;
  }

  const idFor = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;

  for (const [categoryName, name, description, price_cents, is_available] of SEED_ITEMS) {
    const changes = insertItem.run({
      category_id: idFor(categoryName),
      name,
      description,
      price_cents,
      is_available,
    }).changes;
    if (changes > 0) items++;
  }

  return { categories, items };
});

const menu = seedMenu();

// --- Scheduling ------------------------------------------------------------

// [day_of_week (1=Mon..7=Sun), start, end, role, required_staff]
// The Friday and Saturday closing shifts run past midnight on purpose — they exercise the
// overnight handling in shiftBounds().
const SEED_TEMPLATES = [
  [1, '09:00', '17:00', 'server', 2],
  [1, '09:00', '17:00', 'cook', 1],
  [3, '11:00', '19:00', 'server', 2],
  [3, '11:00', '19:00', 'host', 1],
  [5, '17:00', '01:00', 'server', 3],
  [6, '17:00', '01:00', 'server', 3],
  [6, '22:00', '02:00', 'cleaner', 1],
];

const insertTemplate = db.prepare(`
  INSERT INTO shift_templates (day_of_week, start_time, end_time, role, required_staff)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (day_of_week, start_time, end_time, role) DO NOTHING
`);

const seedTemplates = db.transaction(() => {
  let created = 0;
  for (const template of SEED_TEMPLATES) {
    if (insertTemplate.run(...template).changes > 0) created++;
  }
  return created;
});

const templates = seedTemplates();

console.log(`Database: ${DB_PATH}`);
console.log(`Seeded ${created} new user(s); ${SEED_USERS.length - created} already existed.`);
console.log(`Seeded ${menu.categories} new categor(ies) and ${menu.items} new menu item(s).`);
console.log(`Seeded ${templates} new shift template(s).`);
console.table(db.prepare('SELECT id, email, role, is_active FROM users ORDER BY id').all());
console.table(
  db.prepare(`
    SELECT c.name AS category, COUNT(m.id) AS items
    FROM categories c LEFT JOIN menu_items m ON m.category_id = c.id
    GROUP BY c.id ORDER BY c.display_order
  `).all()
);

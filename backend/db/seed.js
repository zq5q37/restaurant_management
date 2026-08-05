const bcrypt = require('bcrypt');
const { db, migrate, DB_PATH } = require('./index');

// Dev convenience: one known password for every seeded account. Override with SEED_PASSWORD.
// These accounts are for local development only — never seed them into a deployed database.
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Passw0rd!23';
const BCRYPT_ROUNDS = 10;

const SEED_USERS = [
  { email: 'customer@example.com', full_name: 'Casey Customer', role: 'customer' },
  { email: 'staff@example.com',    full_name: 'Sam Staff',      role: 'staff'    },
  { email: 'manager@example.com',  full_name: 'Morgan Manager', role: 'manager'  },
  { email: 'admin@example.com',    full_name: 'Alex Admin',     role: 'admin'    },
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

console.log(`Database: ${DB_PATH}`);
console.log(`Seeded ${created} new user(s); ${SEED_USERS.length - created} already existed.`);
console.table(db.prepare('SELECT id, email, role, is_active FROM users ORDER BY id').all());

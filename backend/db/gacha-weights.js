/**
 * Read-only: what is the dish gacha actually pushing, and does the claim hold?
 *
 * The feature claims the draw is tilted toward dishes that are both profitable and overlooked.
 * From outside, that claim is invisible — the API hands back one dish and no reason. This dumps
 * the whole weight table the machine draws from, then draws through the real selector a hundred
 * thousand times to show that the numbers on the table are the numbers that come out.
 *
 * It exits non-zero if the merchandising claim fails, so it is a check and not a pretty-printer.
 *
 *   node db/gacha-weights.js
 *   node db/gacha-weights.js --category=2 --days=30 --draws=100000
 *   docker compose exec backend node db/gacha-weights.js
 */
const { db, DB_PATH } = require('./index');
const { gachaCandidates } = require('../analytics/queries');
const { effectivePriceCents } = require('../menu/pricing');
const {
  VIEW_WINDOW_DAYS,
  W_MARGIN,
  W_OVERLOOKED,
  GAMMA,
  FLOOR,
  weighDraw,
  drawFrom,
} = require('../menu/gacha');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback;
};

const categoryId = arg('category', null);
const windowDays = arg('days', VIEW_WINDOW_DAYS);
const draws = arg('draws', 100000);

/** Deterministic PRNG, inlined so the script adds no dependency. Seeded, so runs are comparable. */
function mulberry32(seed) {
  return function next() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const money = (cents) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`);
const pct = (n, places = 2) => `${(n * 100).toFixed(places)}%`;
const num = (n, places = 3) => n.toFixed(places);

console.log(`Database: ${DB_PATH}`);

const rows = gachaCandidates({ category_id: categoryId, window_days: windowDays });

if (!rows.length) {
  console.log('\nThe machine is empty — no available dish matches that pool.');
  process.exit(0);
}

const categoryLabel =
  categoryId == null ? 'all' : `${categoryId} (${rows[0].category_name})`;
console.log(
  `Pool: ${rows.length} available dish(es) · ${windowDays}-day view window · category: ${categoryLabel}`
);
console.log(
  `Constants: W_MARGIN=${W_MARGIN} W_OVERLOOKED=${W_OVERLOOKED} GAMMA=${GAMMA} FLOOR=${FLOOR}\n`
);

const { candidates, total, neutralMargin } = weighDraw(rows);
const uniform = 1 / candidates.length;

/* ------------------------------------------------------------ weight table ---- */

const ranked = [...candidates].sort((a, b) => b.probability - a.probability);

console.table(
  ranked.map((c) => ({
    Item: c.row.name,
    Category: c.row.category_name,
    'Eff. price': money(effectivePriceCents(c.row)),
    Cost: money(c.row.cost_cents),
    'Margin ¢': c.margin_cents == null ? 'neutral' : c.margin_cents,
    'Views 30d': c.views,
    M: num(c.margin_score),
    O: num(c.overlooked_score),
    Quality: num(c.quality),
    Weight: num(c.weight),
    'Draw %': pct(c.probability),
    'vs uniform': `${(c.probability / uniform).toFixed(2)}x`,
  }))
);

/* ------------------------------------------------------------- monte carlo ---- */

const rng = mulberry32(1);
const observed = new Map(candidates.map((c) => [c.row.id, 0]));
for (let i = 0; i < draws; i += 1) {
  const winner = drawFrom(candidates, total, rng);
  observed.set(winner.row.id, observed.get(winner.row.id) + 1);
}

let maxDelta = 0;
console.log(`\nMonte Carlo — ${draws.toLocaleString()} draws through the real selector:`);
console.table(
  ranked.map((c) => {
    const seen = observed.get(c.row.id) / draws;
    const delta = Math.abs(seen - c.probability) * 100;
    maxDelta = Math.max(maxDelta, delta);
    return {
      Item: c.row.name,
      Expected: pct(c.probability),
      Observed: pct(seen),
      'Δ (pp)': delta.toFixed(3),
    };
  })
);
console.log(`max |Δ| = ${maxDelta.toFixed(3)}pp\n`);

/* ------------------------------------------- the merchandising claim, tested ---- */

/**
 * Split the pool at each median and compare how often the two halves draw. This is the
 * feature's actual promise, so it is asserted rather than asserted-in-prose.
 *
 * Dishes riding on a neutral margin are left out of the margin split: their score is a stand-in,
 * so counting them would be measuring the fallback rather than the claim.
 */
function claim(label, scored, key) {
  if (scored.length < 2) {
    console.log(`CLAIM  ${label} — skipped, needs two or more dishes`);
    return true;
  }

  const sorted = [...scored].sort((a, b) => a[key] - b[key]);
  const half = Math.floor(sorted.length / 2);
  const low = sorted.slice(0, half);
  const high = sorted.slice(sorted.length - half);

  const share = (group) => group.reduce((sum, c) => sum + c.probability, 0) / group.length;
  const ratio = share(high) / share(low);
  const ok = ratio > 1;

  console.log(
    `CLAIM  ${label} draws ${ratio.toFixed(2)}x as often as its opposite   ${ok ? 'OK' : '*** FAIL ***'}`
  );
  return ok;
}

const priced = candidates.filter((c) => c.margin_cents != null);
const marginOk = claim('high-margin half', priced, 'margin_score');
const overlookedOk = claim('overlooked half', candidates, 'overlooked_score');

/* -------------------------------------------------- neutral margin disclosure ---- */

const guessing = candidates.filter((c) => c.margin_cents == null);
if (guessing.length) {
  console.log(
    `\nRiding on a neutral margin (cost_cents not entered, scored at the menu median ${num(neutralMargin)}):`
  );
  for (const c of guessing) console.log(`  ${c.row.name} — draws ${pct(c.probability)}`);
  console.log('  Enter a cost on these and the table stops guessing.');
}

/* --------------------------------------------------------------- invariants ---- */

const probabilitySum = candidates.reduce((sum, c) => sum + c.probability, 0);
const unavailable = candidates.filter((c) => !c.row.is_available);

const invariants = [
  ['total weight > 0', total > 0],
  ['every weight >= FLOOR', candidates.every((c) => c.weight >= FLOOR - 1e-12)],
  ['every weight <= 1', candidates.every((c) => c.weight <= 1 + 1e-12)],
  ['probabilities sum to 1', Math.abs(probabilitySum - 1) < 1e-9],
  ['no unavailable dish in the pool', unavailable.length === 0],
  ['monte carlo within 0.5pp', maxDelta < 0.5],
];

console.log('\nInvariants:');
for (const [label, ok] of invariants) {
  console.log(`  ${ok ? 'pass' : '*** FAIL ***'}  ${label}`);
}

db.close();

const failed = !marginOk || !overlookedOk || invariants.some(([, ok]) => !ok);
process.exit(failed ? 1 : 0);

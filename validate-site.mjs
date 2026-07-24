#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const sum = (records, field) =>
  Object.values(records).reduce((total, record) => total + (Number(record[field]) || 0), 0);

function syntaxCheck(path) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, path)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${path} syntax check failed:\n${result.stderr || result.stdout}`);
}

for (const path of [
  'cloudflare-worker.js',
  'engine.js',
  'functions/sync.js',
  'import-collection.mjs',
]) syntaxCheck(path);

const indexSource = read('index.html');
const logicMatch = indexSource.match(
  /<script type="text\/x-dc"[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/,
);
assert(logicMatch, 'index.html component logic was not found');
const Component = new Function('DCLogic', `${logicMatch[1]}\nreturn Component;`)(class {});

const simulatorSource = read('simulator.html');
const simulatorBundleMatch = simulatorSource.match(
  /<script type="__bundler\/template">([\s\S]*?)<\/script>/,
);
assert(simulatorBundleMatch, 'simulator.html embedded bundle was not found');
const simulatorTemplate = JSON.parse(simulatorBundleMatch[1]);
const simulatorLogicMatch = simulatorTemplate.match(
  /<script type="text\/x-dc"[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/,
);
assert(simulatorLogicMatch, 'simulator.html component logic was not found');
new Function('DCLogic', `${simulatorLogicMatch[1]}\nreturn Component;`)(class {});

const collection = json('collection.json');
const printings = json('collection-printings.json');
const catalogue = json('card-catalog-master.json');
const prices = json('prices.json');

const colKey = (name) => String(name || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[\u2018\u2019\u02BC]/g, "'")
  .replace(/[\\/:*?"<>|]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/4\s*-?\s*town\b/g, '4town');

const grouped = {};
for (const printing of Object.values(printings)) {
  assert(printing.id && printing.id === `${printing.ligaId}:${printing.variant}`,
    `Invalid exact printing id: ${printing.id || '(empty)'}`);
  assert(printing.count > 0, `Invalid printing count: ${printing.id}`);
  assert(printing.imageUrl, `Owned printing has no image URL: ${printing.id}`);
  const key = colKey(printing.name);
  (grouped[key] ||= []).push(printing);
}

assert(Object.keys(grouped).length === Object.keys(collection).length,
  'Exact and legacy collections have different name counts');

for (const [key, card] of Object.entries(collection)) {
  const owned = grouped[key];
  assert(owned, `Legacy card has no exact printing: ${card.name}`);
  const normalQty = owned
    .filter((printing) => printing.variant === 'normal')
    .reduce((total, printing) => total + printing.count, 0);
  const foilQty = owned
    .filter((printing) => printing.variant === 'foil')
    .reduce((total, printing) => total + printing.count, 0);
  assert(card.qty === normalQty + foilQty, `Total quantity mismatch: ${card.name}`);
  assert(card.normalQty === normalQty, `Normal quantity mismatch: ${card.name}`);
  assert(card.foilQty === foilQty && card.foil === foilQty, `Foil quantity mismatch: ${card.name}`);
  assert(card.rarity, `Missing rarity: ${card.name}`);
}

const databaseIds = Object.keys(catalogue);
assert(new Set(databaseIds).size === databaseIds.length, 'Duplicate catalogue Database ID');
assert(Object.values(catalogue).every((card) =>
  !Object.hasOwn(card, 'ownedNormal')
  && !Object.hasOwn(card, 'ownedFoil')
  && !Object.hasOwn(card, 'inCollection')),
'Shared catalogue contains user ownership fields');

const catalogueLigaIds = new Set(Object.values(catalogue).map((card) => card.ligaId).filter(Boolean));
assert(Object.values(printings).every((printing) => catalogueLigaIds.has(printing.ligaId)),
  'Owned printing is missing from the shared catalogue');

assert(indexSource.includes("this.PKEY='lorcanaAtlas_collection_printings_v1__'+this.NS"),
  'Exact-printing storage is not namespaced by user');
assert(indexSource.includes("this.KEY='lorcanaAtlas_games_v1__'+this.NS"),
  'Game storage is not namespaced by user');
assert(indexSource.includes("this.LKEY='lorcanaAtlas_decks_v1__'+this.NS"),
  'Deck storage is not namespaced by user');
assert(indexSource.includes("this.CKEY='lorcanaAtlas_collection_v1__'+this.NS"),
  'Collection storage is not namespaced by user');
assert(indexSource.includes("this.VKEY='lorcanaAtlas_variants_v1__'+this.NS"),
  'Variant storage is not namespaced by user');
assert(indexSource.includes("this.IKKEY='lorcanaAtlas_inkable_v1__'+this.NS"),
  'Inkable overrides are not namespaced by user');
assert(!indexSource.includes("fetch((typeof window!=='undefined'&&window.__resources&&window.__resources.collectionJson)"),
  'A global collection seed is still active');
assert(indexSource.includes("if(this.IS_PRIMARY){\n      fetch('dale-games.json')"),
  'Primary game history is not account-gated');
assert(indexSource.includes("return {doc:null, sha:null};\n  }\n  queueSync()"),
  'User data still has a public static read fallback');
assert(indexSource.includes("p&&p.match_status==='matched_name_mismatch'"),
  'Known mismatched price rows are not filtered');

assert(simulatorTemplate.includes(
  "GKEY(){ const s=this.session(); return 'lorcanaSim_game_v1__'+this.safeUserKey(s&&s.user||'anon'); }",
), 'Simulator game state is not namespaced by user');
assert(simulatorTemplate.includes(
  "const key='lorcanaAtlas_decks_v1__'+this.safeUserKey(s&&s.user||'anon')",
), 'Simulator decks are not scoped to the signed-in user');
assert(!simulatorTemplate.includes(
  "if(!/^lorcanaAtlas_decks_v1__/.test(key)) continue",
), 'Simulator still scans deck data belonging to every account');
assert(simulatorTemplate.includes(
  "localStorage.setItem('lorcanaAtlas_inkable_v1__'+this.safeUserKey(s.user)",
), 'Simulator inkable overrides are not namespaced by user');
assert(!simulatorTemplate.includes(
  "localStorage.setItem('lorcanaAtlas_inkable_v1',",
), 'Simulator still writes global inkable overrides');
assert(!simulatorTemplate.includes(
  "const path=key==='luiscredie'?'atlas-data.json'",
), 'Simulator still reads public user-data files as a fallback');

globalThis.window = {};
new Function(read('card-db.js'))();
const app = new Component();
app.state = { ...(app.state || {}), collection, variants: {} };

const csvFixture = '\uFEFFCount,Name,Set Number,Card Number,Variant,Color,Rarity\r\n'
  + '2,"Hamish, Hubert & Harris",12,77,Normal,Amber,Rare\r\n'
  + '3,"Hamish, Hubert & Harris",12,77,Foil,Amber,Rare\r\n'
  + '1,"Belle ""Mystic""",1,5,Normal,Sapphire,Common\r\n';
const csvImport = app.parseCsvText(csvFixture);
assert(csvImport.stats.rows === 3 && csvImport.stats.names === 2,
  'Dreamborn CSV parser did not preserve distinct printing rows/names');
assert(csvImport.stats.total === 6 && csvImport.stats.foilCopies === 3,
  'Dreamborn CSV parser produced incorrect normal/foil totals');
assert(Object.values(csvImport.collection).some((card) =>
  card.name === 'Hamish, Hubert & Harris'
  && card.normalQty === 2
  && card.foilQty === 3
  && card.qty === 5),
'Dreamborn CSV parser lost quoted names or normal/foil quantities');

const normalizedCardDb = app.cardDb();
assert(Object.values(collection).every((card) => normalizedCardDb[app.colKey(card.name)]),
  'An owned card cannot be resolved in the normalized cardbase');

app._prices = app.buildPriceMap(prices);
let exactPrices = 0;
let approximatePrices = 0;
let missingPrices = 0;
let wrongExactPrices = 0;
for (const card of Object.values(collection)) {
  const key = app.pkey(card);
  const info = app.priceInfo(card.name, key);
  if (info.brl == null) missingPrices += 1;
  else if (info.exact) exactPrices += 1;
  else approximatePrices += 1;
  const hit = key && app._priceBySetNum[key];
  if (info.brl != null && info.exact && hit && hit.ck !== app.colKey(card.name)) {
    wrongExactPrices += 1;
  }
}
assert(wrongExactPrices === 0, `${wrongExactPrices} exact prices belong to another card`);

let mismatchesIndexedAsExact = 0;
for (const entry of Object.values(prices.prices || {})) {
  for (const printing of entry.printings || []) {
    if (printing.match_status !== 'matched_name_mismatch') continue;
    const edition = String(printing.edition || '').match(/^LOR(\d+)$/i);
    const number = parseInt(printing.number, 10);
    if (!edition || !Number.isFinite(number)) continue;
    const key = `${String(parseInt(edition[1], 10)).padStart(3, '0')}|${number}`;
    const hit = app._priceBySetNum[key];
    const entryCardKey = entry.card_db_key || app.colKey(entry.base_name);
    if (hit && hit.ck === entryCardKey) mismatchesIndexedAsExact += 1;
  }
}
assert(mismatchesIndexedAsExact === 0,
  `${mismatchesIndexedAsExact} known mismatched price rows entered the exact index`);

const legacySync = read('functions/sync.js');
assert(legacySync.includes('status: 410'), 'Legacy unauthenticated sync endpoint is not disabled');

const worker = read('cloudflare-worker.js');
assert(worker.includes('session.role !== "admin" && session.role !== "editor"'),
  'Worker does not enforce editor/admin write roles');
assert(worker.includes('const file = fileForUser(env, session.user, account)'),
  'Worker does not resolve data paths from the signed user');
assert(worker.includes('(!users && !env.USERS_KV)'),
  'KV-only account configuration is not supported');
assert(worker.includes('user === safeUserKey(user)'),
  'Worker does not reject usernames that can collide after normalization');

console.log(JSON.stringify({
  status: 'PASS',
  catalogue: {
    records: databaseIds.length,
    editions: new Set(Object.values(catalogue).map((card) => card.editionCode)).size,
    ownershipFields: 0,
  },
  collection: {
    exactRows: Object.keys(printings).length,
    names: Object.keys(collection).length,
    copies: sum(collection, 'qty'),
    normal: sum(collection, 'normalQty'),
    foil: sum(collection, 'foil'),
    missingOwnedImages: 0,
    missingRarities: 0,
  },
  pricing: {
    exact: exactPrices,
    approximate: approximatePrices,
    missing: missingPrices,
    wrongExact: wrongExactPrices,
    knownMismatchesIndexed: mismatchesIndexedAsExact,
  },
  accountIsolation: {
    collection: true,
    printings: true,
    decks: true,
    games: true,
    variants: true,
    inkableOverrides: true,
  },
}, null, 2));

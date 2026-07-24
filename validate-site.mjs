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

const pythonEnv = {
  ...process.env,
  PYTHONPYCACHEPREFIX: '/tmp/lorcana-price-agent-pycache',
};
const pyCompile = spawnSync(
  'python3',
  ['-m', 'py_compile', resolve(root, 'price_agent.py'), resolve(root, 'validate-price-agent.py')],
  { encoding: 'utf8', env: pythonEnv },
);
if (pyCompile.status !== 0) {
  fail(`Python syntax check failed:\n${pyCompile.stderr || pyCompile.stdout}`);
}
const priceAgentValidation = spawnSync(
  'python3',
  [resolve(root, 'validate-price-agent.py')],
  { encoding: 'utf8', env: pythonEnv },
);
if (priceAgentValidation.status !== 0) {
  fail(`Price agent regression check failed:\n${priceAgentValidation.stderr || priceAgentValidation.stdout}`);
}

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
app.state = { ...(app.state || {}), collection, collectionPrintings: printings, variants: {} };

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

assert(indexSource.includes("const hasExactOwned=exactOwned.length>0"),
  'Collection view does not prefer exact owned printings');
assert(indexSource.includes("price:printing?this.priceChipForPrinting(printing)"),
  'Collection rows are not priced by exact printing');

const annaPrintings = Object.values(printings).filter((printing) =>
  printing.name === 'Anna - True-Hearted');
assert(annaPrintings.length === 2, 'Anna exact-printing fixture is incomplete');
assert(new Set(annaPrintings.map((printing) => printing.ligaId)).has('LOR4-138')
  && new Set(annaPrintings.map((printing) => printing.ligaId)).has('LOR9-137'),
'Anna set 4 and set 9 printings are not distinct');
const derived = app.deriveCollectionFromPrintings(printings);
assert(derived['anna - true-hearted'].qty === 2
  && derived['anna - true-hearted'].printingCount === 2,
'Exact Anna rows do not derive the expected legacy compatibility count');
const withManualAnna = app.withManualCopies(
  printings,
  'Anna - True-Hearted',
  1,
  collection['anna - true-hearted'],
);
assert(Object.keys(withManualAnna).length === Object.keys(printings).length + 1,
  'A manual addition erased or replaced an existing exact printing');
assert(Object.keys(printings).length === 528,
  'A manual addition mutated the exact-printing source object');
const manualDerived = app.deriveCollectionFromPrintings(withManualAnna);
assert(manualDerived['anna - true-hearted'].qty === 3,
  'A manual addition was not included in the derived compatibility collection');

const anna4 = annaPrintings.find((printing) => printing.ligaId === 'LOR4-138');
const anna9 = annaPrintings.find((printing) => printing.ligaId === 'LOR9-137');
const challengeLetItGo = Object.values(printings).find((printing) =>
  printing.ligaId === 'DLPC1-10-C2');
const anna4Price = app.priceInfoForPrinting(anna4);
const anna9Price = app.priceInfoForPrinting(anna9);
const challengePrice = app.priceInfoForPrinting(challengeLetItGo);
assert(anna4Price.exact && anna4Price.brl === 3.49,
  'Anna LOR4-138 did not resolve its exact Liga price');
assert(app.priceInfoForPrinting({
  name: 'Anna - True-Hearted',
  set: 'LOR4',
  num: '138',
  variant: 'foil',
}).brl === 5.99,
'The set/number compatibility fallback merged foil into the normal price');
assert(anna9Price.exact && anna9Price.brl === 0.99,
  'Anna LOR9-137 did not resolve its exact Liga price');
assert(challengePrice.exact && challengePrice.brl === 790,
  'Let It Go DLPC1-10-C2 did not resolve its exact challenge price');
assert(!app._priceByLigaId['LOR9-138'],
  'Name-mismatched Huey LOR9-138 entered the exact ligaId index');

app._fileTreeMulti = {
  [app.colKey('Anna - True-Hearted')]: [
    '004 - 138 - Anna - True-Hearted.jpg',
    '009 - 137 - Anna - True-Hearted.jpg',
  ],
  [app.colKey('Let It Go')]: [
    '001 - 10 - Let it Go.jpg',
    '001 - 163 - Let It Go.jpg',
    '001 - 2 - Let It Go.jpg',
    '011 - 163 - Let It Go.jpg',
  ],
};
app.state.variants = {
  [app.colKey('Anna - True-Hearted')]: '004 - 138 - Anna - True-Hearted.jpg',
  [app.colKey('Let It Go')]: '001 - 10 - Let it Go.jpg',
};
assert(app.variantPrinting('Anna - True-Hearted')?.ligaId === 'LOR4-138'
  && app.priceInfo('Anna - True-Hearted').brl === 3.49,
'Selected Anna art is not linked to its exact owned printing/price');
assert(app.variantPrinting('Let It Go')?.ligaId === 'DLPC1-10-C2'
  && app.priceInfo('Let It Go').brl === 790,
'Selected Let It Go challenge art did not use its own exact price');

const artPriceCases = [
  ['001 - 10 - Let it Go.jpg', 'DLPC1-10-C2', 790],
  ['001 - 163 - Let It Go.jpg', 'LOR1-163', 19.90],
  ['001 - 2 - Let It Go.jpg', 'DLPC1-2-C1', 2999.90],
  ['011 - 163 - Let It Go.jpg', 'LOR11-163', 12.99],
];
for (const [file, ligaId, expectedPrice] of artPriceCases) {
  app.state.variants[app.colKey('Let It Go')] = file;
  assert(app.variantPrinting('Let It Go')?.ligaId === ligaId,
    `${file} did not map to ${ligaId}`);
  assert(app.priceInfo('Let It Go').brl === expectedPrice,
    `${file} did not resolve price ${expectedPrice}`);
}
app.state.variants[app.colKey('Anna - True-Hearted')] =
  '009 - 137 - Anna - True-Hearted.jpg';
assert(app.variantPrinting('Anna - True-Hearted')?.ligaId === 'LOR9-137'
  && app.priceInfo('Anna - True-Hearted').brl === 0.99,
'Selected Anna set 9 art did not use the LOR9-137 price');

const v4App = new Component();
v4App.state = { collection: {}, collectionPrintings: {}, variants: {} };
v4App._prices = v4App.buildPriceMap({
  prices_by_liga_id: {
    'TEST-1': {
      liga_id: 'TEST-1',
      name: 'Test Card',
      edition: 'DLPC1',
      number: '10-C2',
      normal: { low: 7.77 },
      foil: { low: 8.88 },
      match_status: 'matched',
    },
  },
  prices: {
    '999-001': {
      card_db_key: 'test card',
      base_name: 'Test Card',
      printings: [{
        liga_id: 'TEST-1',
        name: 'Test Card',
        edition: 'LOR999',
        number: '1',
        normal: { low: 1.11 },
        foil: { low: 2.22 },
        minimum_price_brl: 1.11,
        match_status: 'matched',
      }],
    },
  },
});
assert(v4App.priceInfoForPrinting({
  ligaId: 'TEST-1', name: 'Test Card', variant: 'normal',
}).brl === 7.77
  && v4App.priceInfoForPrinting({
    ligaId: 'TEST-1', name: 'Test Card', variant: 'foil',
  }).brl === 8.88,
'Schema v4 ligaId index does not preserve separate normal/foil prices');
assert(v4App._priceByLigaId['TEST-1'].normal === 7.77,
  'The legacy compatibility map overwrote the authoritative schema v4 ligaId price');

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
    annaSet4: anna4Price.brl,
    annaSet9: anna9Price.brl,
    letItGoChallenge: challengePrice.brl,
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

#!/usr/bin/env node
// Idempotent Dreamborn -> LigaLorcana collection importer.
//
// The catalogue is shared by every account. Ownership is written only to the
// explicitly selected user document, so collections, decks and games never mix.
//
// Example:
//   node import-collection.mjs \
//     --master uploads/lorcana_card_database_master.csv \
//     --map uploads/mapeamento_dreamborn_ligalorcana.csv \
//     --user-data atlas-data.json
//
// For another account, use its own document:
//   node import-collection.mjs ... --user-data data/thaiscredie.json
//
// Optional offline exports (not required by the site):
//   --legacy-output export/collection.json
//   --printings-output export/collection-printings.json
//
// The importer replaces the selected user's collection snapshot. It never sums
// with an earlier import and preserves all unrelated user fields.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULTS = {
  master: 'uploads/lorcana_card_database_master.csv',
  map: 'uploads/mapeamento_dreamborn_ligalorcana.csv',
  userData: '',
  catalogOutput: 'card-catalog-master.json',
  legacyOutput: '',
  printingsOutput: '',
};

const FLAG_MAP = {
  '--master': 'master',
  '--map': 'map',
  '--user-data': 'userData',
  '--catalog-output': 'catalogOutput',
  '--legacy-output': 'legacyOutput',
  '--printings-output': 'printingsOutput',
};

const RARITY = {
  C: 'Common',
  U: 'Uncommon',
  R: 'Rare',
  SR: 'Super Rare',
  L: 'Legendary',
  E: 'Enchanted',
  EP: 'Epic',
  P: 'Promo',
};

const COLOR = {
  S: 'Sapphire',
  A: 'Amber',
  E: 'Emerald',
  R: 'Ruby',
  T: 'Steel',
  M: 'Amethyst',
};

function usage() {
  return [
    'Usage:',
    '  node import-collection.mjs --master <catalog.csv> --map <mapping.csv> --user-data <user.json>',
    '',
    'Required for a collection import:',
    '  --user-data          User document to update (atlas-data.json or data/<user>.json)',
    '',
    'Optional:',
    '  --catalog-output     Shared catalogue output (default: card-catalog-master.json)',
    '  --legacy-output      Additional legacy collection export',
    '  --printings-output   Additional exact-printings export',
    '  --help               Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      console.log(usage());
      process.exit(0);
    }
    const key = FLAG_MAP[flag];
    if (!key) throw new Error(`Unknown option: ${flag}\n\n${usage()}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    options[key] = value;
  }
  if (!options.userData) {
    throw new Error(`--user-data is required so ownership is never written globally.\n\n${usage()}`);
  }
  return Object.fromEntries(Object.entries(options).map(([key, value]) => [key, value ? resolve(value) : '']));
}

function parseCSV(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (quoted) throw new Error('Malformed CSV: unclosed quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
}

function requireHeaders(headers, required, label) {
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`${label} is missing columns: ${missing.join(', ')}`);
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    quot: '"',
    ndash: '–',
    mdash: '—',
    rsquo: '’',
  };
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function colKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/4\s*-?\s*town\b/g, '4town');
}

function normalizedSet(value) {
  const source = String(value || '').trim();
  const lor = source.match(/^LOR(\d+)$/i);
  if (lor) return String(parseInt(lor[1], 10)).padStart(3, '0');
  if (/^\d+$/.test(source)) return String(parseInt(source, 10)).padStart(3, '0');
  return source;
}

function normalizedNumber(value) {
  const source = String(value || '').trim();
  return /^\d+$/.test(source) ? parseInt(source, 10) : source;
}

function isRegular(printing) {
  return /^LOR\d+$/i.test(printing.set)
    && !/epic|enchanted/i.test(`${printing.rarity || ''} ${printing.ligaNameRaw || ''}`);
}

function readJson(path, fallback = {}) {
  if (!path || !existsSync(path)) return fallback;
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${path}`);
  }
  return value;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function buildCatalogue(path) {
  const rows = parseCSV(readFileSync(path, 'utf8'));
  const headers = rows[0] || [];
  requireHeaders(headers, [
    'Database ID',
    'LigaLorcana ID',
    'Display Name',
    'Edicao (EN)',
    'Edicao (Sigla)',
    'Card #',
    'Card (EN)',
    'Raridade',
    'Cor (C D O E Y F R G L M P W)',
  ], 'Master catalogue');

  const catalogue = {};
  const editions = new Set();
  for (const row of rows.slice(1)) {
    const record = rowObject(headers, row);
    const databaseId = record['Database ID'];
    if (!databaseId) continue;
    if (catalogue[databaseId]) throw new Error(`Duplicate Database ID: ${databaseId}`);
    editions.add(record['Edicao (Sigla)']);
    catalogue[databaseId] = {
      databaseId,
      ligaId: record['LigaLorcana ID'],
      displayName: record['Display Name'],
      imageUrl: record['Image URL'] || '',
      editionName: record['Edicao (EN)'],
      editionCode: record['Edicao (Sigla)'],
      cardNumber: record['Card #'],
      ligaNameRaw: record['Card (EN)'],
      rarity: record.Raridade,
      color: record['Cor (C D O E Y F R G L M P W)'],
      extra: record.Extras,
    };
  }
  return { catalogue, editionCount: editions.size };
}

function buildPrintings(path) {
  const rows = parseCSV(readFileSync(path, 'utf8'));
  const headers = rows[0] || [];
  requireHeaders(headers, [
    'LigaLorcana ID',
    'Variant',
    'Count',
    'LigaLorcana Edition Code',
    'LigaLorcana Card Number',
    'Name',
    'LigaLorcana Card Name',
    'LigaLorcana Color Code',
    'LigaLorcana Rarity Code',
    'Image URL',
  ], 'Collection mapping');

  const printings = {};
  const ligaIds = new Set();
  let total = 0;
  let normalCopies = 0;
  let foilCopies = 0;
  let foilRows = 0;
  let rowsWithoutUrl = 0;

  for (const row of rows.slice(1)) {
    const record = rowObject(headers, row);
    const ligaId = String(record['LigaLorcana ID'] || '').trim();
    if (!ligaId) continue;
    const variant = String(record.Variant || 'normal').trim().toLowerCase();
    if (variant !== 'normal' && variant !== 'foil') {
      throw new Error(`Unsupported variant for ${ligaId}: ${variant}`);
    }
    const count = parseInt(record.Count, 10);
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`Invalid count for ${ligaId}:${variant}: ${record.Count}`);
    }
    const id = `${ligaId}:${variant}`;
    if (printings[id]) throw new Error(`Duplicate collection row: ${id}`);

    const imageUrl = String(record['Image URL'] || '').trim();
    if (!imageUrl) rowsWithoutUrl += 1;
    total += count;
    ligaIds.add(ligaId);
    if (variant === 'foil') {
      foilCopies += count;
      foilRows += 1;
    } else {
      normalCopies += count;
    }

    printings[id] = {
      id,
      ligaId,
      variant,
      count,
      set: record['LigaLorcana Edition Code'],
      num: record['LigaLorcana Card Number'],
      name: record.Name,
      ligaNameRaw: record['LigaLorcana Card Name'],
      displayName: decodeEntities(record['LigaLorcana Card Name'] || record.Name),
      color: record['LigaLorcana Color Code'],
      rarity: record['LigaLorcana Rarity Code'],
      imageUrl,
      dbSet: record['Set Number'],
      dbNum: record['Card Number'],
    };
  }

  return {
    printings,
    stats: {
      rows: Object.keys(printings).length,
      total,
      normalCopies,
      foilCopies,
      foilRows,
      distinctLigaIds: ligaIds.size,
      rowsWithoutUrl,
    },
  };
}

function buildLegacy(printings, existing) {
  const groups = {};
  for (const printing of Object.values(printings)) {
    const key = colKey(printing.name);
    (groups[key] ||= []).push(printing);
  }

  const legacy = {};
  const fallbackRepresentatives = [];
  for (const [key, ownedPrintings] of Object.entries(groups)) {
    const normalQty = ownedPrintings
      .filter((printing) => printing.variant === 'normal')
      .reduce((sum, printing) => sum + printing.count, 0);
    const foilQty = ownedPrintings
      .filter((printing) => printing.variant === 'foil')
      .reduce((sum, printing) => sum + printing.count, 0);
    const printingCount = new Set(ownedPrintings.map((printing) => printing.ligaId)).size;
    const previous = existing[key];

    let representative = null;
    if (previous && previous.set != null && previous.num != null) {
      representative = ownedPrintings.find((printing) =>
        normalizedSet(printing.set) === normalizedSet(previous.set)
        && String(normalizedNumber(printing.num)) === String(normalizedNumber(previous.num)));
    }
    if (!representative) {
      const regular = ownedPrintings.filter(isRegular);
      const pool = regular.length ? regular : ownedPrintings;
      const normal = pool.filter((printing) => printing.variant === 'normal');
      representative = (normal.length ? normal : pool)
        .slice()
        .sort((a, b) =>
          (parseInt(a.num, 10) || 9999) - (parseInt(b.num, 10) || 9999)
          || String(a.ligaId).localeCompare(String(b.ligaId)))[0];
      if (!regular.length) fallbackRepresentatives.push(`${ownedPrintings[0].name} (no regular printing owned)`);
    }

    const set = normalizedSet(representative.set);
    legacy[key] = {
      name: ownedPrintings[0].name,
      qty: normalQty + foilQty,
      foil: foilQty,
      color: previous?.color || COLOR[representative.color] || representative.color || '',
      rarity: previous?.rarity || RARITY[representative.rarity] || representative.rarity || '',
      set,
      num: normalizedNumber(representative.num),
      normalQty,
      foilQty,
      printingCount,
      pricingApproximate: printingCount > 1 || foilQty > 0 || !/^\d+$/.test(set),
    };
  }
  return { legacy, fallbackRepresentatives };
}

function validate(catalogue, printings, legacy, stats) {
  const catalogueIds = Object.keys(catalogue);
  if (new Set(catalogueIds).size !== catalogueIds.length) {
    throw new Error('Catalogue contains duplicate Database IDs');
  }

  const printingIds = Object.keys(printings);
  if (new Set(printingIds).size !== printingIds.length) {
    throw new Error('Collection contains duplicate printing IDs');
  }

  const legacyTotal = Object.values(legacy).reduce((sum, record) => sum + record.qty, 0);
  const legacyNormal = Object.values(legacy).reduce((sum, record) => sum + record.normalQty, 0);
  const legacyFoil = Object.values(legacy).reduce((sum, record) => sum + record.foil, 0);
  const missingRarity = Object.values(legacy).filter((record) => !record.rarity).length;

  if (legacyTotal !== stats.total) {
    throw new Error(`Legacy total (${legacyTotal}) differs from exact snapshot (${stats.total})`);
  }
  if (legacyNormal !== stats.normalCopies) {
    throw new Error(`Legacy normal total (${legacyNormal}) differs from exact snapshot (${stats.normalCopies})`);
  }
  if (legacyFoil !== stats.foilCopies) {
    throw new Error(`Legacy foil total (${legacyFoil}) differs from exact snapshot (${stats.foilCopies})`);
  }
  if (stats.rowsWithoutUrl) {
    throw new Error(`${stats.rowsWithoutUrl} owned printing row(s) have no image URL`);
  }
  if (missingRarity) {
    throw new Error(`${missingRarity} legacy card(s) have no rarity`);
  }

  return {
    catalogueRecords: catalogueIds.length,
    printingRows: printingIds.length,
    legacyNames: Object.keys(legacy).length,
    legacyTotal,
    legacyNormal,
    legacyFoil,
    missingRarity,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const userData = readJson(options.userData, { v: 1 });
  const existingCollection = userData.collection && typeof userData.collection === 'object'
    && !Array.isArray(userData.collection) ? userData.collection : {};

  const { catalogue, editionCount } = buildCatalogue(options.master);
  const { printings, stats } = buildPrintings(options.map);
  const { legacy, fallbackRepresentatives } = buildLegacy(printings, existingCollection);
  const report = validate(catalogue, printings, legacy, stats);
  const importedAt = new Date().toISOString();

  const updatedUserData = {
    ...userData,
    v: userData.v || 1,
    updated: importedAt,
    collection: legacy,
    colUpdated: importedAt,
    collectionPrintings: printings,
    collectionPrintingsUpdated: importedAt,
  };

  writeJson(options.catalogOutput, catalogue);
  writeJson(options.userData, updatedUserData);
  if (options.legacyOutput) writeJson(options.legacyOutput, legacy);
  if (options.printingsOutput) writeJson(options.printingsOutput, printings);

  console.log('— Shared card catalogue —');
  console.log(`  records: ${report.catalogueRecords}  editions: ${editionCount}`);
  console.log('— Selected user collection —');
  console.log(`  exact rows: ${report.printingRows}  distinct ligaId: ${stats.distinctLigaIds}`);
  console.log(`  copies: ${report.legacyTotal} (${report.legacyNormal} normal + ${report.legacyFoil} foil)`);
  console.log(`  names: ${report.legacyNames}  image URLs missing: ${stats.rowsWithoutUrl}  rarities missing: ${report.missingRarity}`);
  console.log(`  user data: ${options.userData}`);
  if (fallbackRepresentatives.length) {
    console.log(`  representative fallbacks: ${fallbackRepresentatives.length}`);
  }
}

main();

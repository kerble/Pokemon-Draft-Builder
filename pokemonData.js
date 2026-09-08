import fs from 'fs';
import path from 'path';
import { resolveSpecies } from './names.js';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const SOURCES = {
  pokedex: 'https://play.pokemonshowdown.com/data/pokedex.json',
  learnsets: 'https://play.pokemonshowdown.com/data/learnsets.json',
  moves: 'https://play.pokemonshowdown.com/data/moves.json',
};

const mem = {}; // in-process cache, one fetch per server run

function toID(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function loadSource(key) {
  if (mem[key]) return mem[key];

  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(cachePath)) {
    mem[key] = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    return mem[key];
  }

  const res = await fetch(SOURCES[key]);
  if (!res.ok) throw new Error(`Failed to fetch ${key} from Showdown: ${res.status}`);
  const data = await res.json();

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(data));
  mem[key] = data;
  return data;
}

/**
 * Returns [{ name, cat, bp, type }] for every move `displayName` can legally
 * learn in the given gen, any way (level/TM/tutor/egg). Pulls from Showdown's
 * own compiled dex data.
 *
 * Showdown stores a move on the *lowest* evolution that can learn it, and the
 * validator walks the `prevo` chain — so Samurott-Hisui's Sacred Sword lives
 * on Oshawott's entry, not Samurott-Hisui's. We merge the whole pre-evolution
 * chain here. Megas / cosmetic formes with no learnset of their own fall back
 * to their base species (and that species' prevo chain).
 */
export async function getLearnset(displayName, gen = 9) {
  const [learnsets, moves, pokedex] = await Promise.all([
    loadSource('learnsets'),
    loadSource('moves'),
    loadSource('pokedex'),
  ]);

  // Canonicalise the draft-sheet display name first ("Mega Delphox" ->
  // "Delphox-Mega", "Hisuian Samurott" -> "Samurott-Hisui").
  const canon = resolveSpecies(displayName) || displayName;
  let id = toID(canon);
  let dexEntry = pokedex[id];

  // If this forme has no learnset of its own (megas, cosmetic formes), the
  // learnset lives on the base species.
  if (!learnsets[id]?.learnset && dexEntry?.baseSpecies && learnsets[toID(dexEntry.baseSpecies)]?.learnset) {
    id = toID(dexEntry.baseSpecies);
    dexEntry = pokedex[id];
  }

  // Collect this species + every pre-evolution, then union their learnsets so
  // a gen-9 source anywhere in the chain counts as legal.
  const chainIds = [id];
  let cur = dexEntry;
  while (cur?.prevo) {
    const pid = toID(cur.prevo);
    if (!pokedex[pid] || chainIds.includes(pid)) break;
    chainIds.push(pid);
    cur = pokedex[pid];
  }

  const merged = {};
  for (const cid of chainIds) {
    const ls = learnsets[cid]?.learnset;
    if (!ls) continue;
    for (const [mv, src] of Object.entries(ls)) {
      merged[mv] = merged[mv] ? merged[mv].concat(src) : src.slice();
    }
  }

  if (Object.keys(merged).length === 0) {
    const fallbackId = toID(canon.split('-')[0]);
    if (learnsets[fallbackId]?.learnset) Object.assign(merged, learnsets[fallbackId].learnset);
  }
  if (Object.keys(merged).length === 0) return [];

  const genPrefix = String(gen);
  const byName = new Map();
  const add = md => byName.set(md.name, { name: md.name, cat: md.category, bp: md.basePower, type: md.type });
  for (const [moveId, sources] of Object.entries(merged)) {
    if (!sources.some(src => src.startsWith(genPrefix))) continue;
    const moveData = moves[moveId];
    if (moveData) add(moveData);
  }

  // League-specific movepool tweaks (data/movepoolOverrides.js).
  const { MOVEPOOL_OVERRIDES } = await import('./data/movepoolOverrides.js');
  const ov = MOVEPOOL_OVERRIDES[canon] || MOVEPOOL_OVERRIDES[dexEntry?.baseSpecies];
  if (ov) {
    for (const name of ov.add || []) {
      const md = moves[toID(name)];
      if (md) add(md);
    }
    for (const name of ov.remove || []) byName.delete(name);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The curated competitive item list (data/competitiveItems.js), de-duped and
 * validated against @smogon/calc's own Gen 9 item names so every entry the
 * picker offers is one the evaluator can actually use. Anything that doesn't
 * match a calc item name is dropped with a warning. Showdown has no
 * items.json endpoint (only items.js), which is why this isn't fetched.
 */
export async function getAllItemNames() {
  const [{ COMPETITIVE_ITEMS }, calc] = await Promise.all([
    import('./data/competitiveItems.js'),
    import('@smogon/calc'),
  ]);
  const valid = new Set(calc.default.ITEMS[9]);
  const seen = new Set();
  const out = [];
  for (const name of COMPETITIVE_ITEMS) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (valid.has(name)) out.push(name);
    else console.warn(`competitiveItems: "${name}" is not a Gen 9 @smogon/calc item — skipped`);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

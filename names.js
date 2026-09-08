import fs from 'fs';
import path from 'path';

// The draft sheet (KDA.csv) writes Pokémon in "display" style — "Hisuian
// Samurott", "Mega Diancie", "Calyrex-Ice Rider". Showdown's data, the sets
// file, and @smogon/calc all use canonical IDs — "Samurott-Hisui",
// "Diancie-Mega", "Calyrex-Ice". This maps the former to the latter so a
// single name works everywhere downstream.

const dex = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), '.cache', 'pokedex.json'), 'utf-8')
);

function toID(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Tried in order; first transform whose result exists in the dex wins.
const TRANSFORMS = [
  n => n,
  n => n.replace(/^Hisuian (.+)$/, '$1-Hisui'),
  n => n.replace(/^Alolan (.+)$/, '$1-Alola'),
  n => n.replace(/^Galarian (.+)$/, '$1-Galar'),
  n => n.replace(/^Paldean Tauros(?:-(Aqua|Blaze))?$/, (_, b) => `Tauros-Paldea-${b || 'Combat'}`),
  n => n.replace(/^Paldean (.+)$/, '$1-Paldea'),
  n => n.replace(/^Mega (.+?)(?: ([XY]))?$/, (_, a, b) => `${a}-Mega${b ? '-' + b : ''}`),
  n => n.replace(/-Ice Rider$/, '-Ice').replace(/-Shadow Rider$/, '-Shadow'),
];

// The handful that no rule catches. The two "Mega" entries are quirks of the
// draft sheet — neither Pokémon actually has a Mega forme. Palafin is drafted
// as "Palafin" but Zero to Hero means it fights in Hero forme, so that's the
// stat line we want.
const EXPLICIT = {
  'Mega Floette-Eternal': 'Floette-Eternal',
  'Mega Meowstic': 'Meowstic',
  'Palafin': 'Palafin-Hero',
};

const cache = new Map();

/**
 * Display name -> canonical Showdown species name (as it appears in
 * pokedex.json's `name` field). Returns null if nothing resolves.
 */
export function resolveSpecies(displayName) {
  if (cache.has(displayName)) return cache.get(displayName);

  let resolved = null;
  if (EXPLICIT[displayName]) {
    resolved = dex[toID(EXPLICIT[displayName])]?.name ?? null;
  } else {
    for (const xf of TRANSFORMS) {
      const hit = dex[toID(xf(displayName))];
      if (hit) { resolved = hit.name; break; }
    }
    if (!resolved) {
      const base = dex[toID(displayName.split('-')[0])];
      if (base) resolved = base.name;
    }
  }

  cache.set(displayName, resolved);
  return resolved;
}

/** Canonical species entry from pokedex.json, or null. */
export function speciesData(displayName) {
  const name = resolveSpecies(displayName);
  return name ? dex[toID(name)] : null;
}

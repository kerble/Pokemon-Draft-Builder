import { resolveSpecies } from './names.js';

// gen9_filtered.js is `export const SETDEX_SV = { "Species": { "Set name":
// {ability,item,nature,teraType?,evs,ivs?,moves} } }` with calc-shorthand
// stat keys (at/df/sa/sd/sp). Normalise those to full keys on load.

const EV_KEY = { hp: 'hp', at: 'atk', df: 'def', sa: 'spa', sd: 'spd', sp: 'spe' };

function normStats(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = EV_KEY[k] ?? k;
    out[key] = v;
  }
  return out;
}

let bySpecies = null;

async function load() {
  if (bySpecies) return bySpecies;
  const mod = await import('./gen9_filtered.js');
  const raw = mod.SETDEX_SV || mod.default;
  bySpecies = new Map();
  for (const [species, sets] of Object.entries(raw)) {
    const list = Object.entries(sets).map(([name, s]) => ({
      name,
      ability: s.ability,
      item: s.item || undefined,
      nature: s.nature || 'Serious',
      teraType: s.teraType,
      evs: normStats(s.evs),
      ivs: s.ivs ? normStats(s.ivs) : undefined,
      moves: s.moves || [],
    }));
    bySpecies.set(species, list);
  }
  return bySpecies;
}

/** All known sets for a display name, canonicalised. Empty array if none. */
export async function allSets(displayName) {
  const map = await load();
  const canon = resolveSpecies(displayName);
  return (canon && map.get(canon)) || map.get(displayName) || [];
}

/**
 * What the threat model needs about an opponent:
 *  - `moves`: the *union* of every move any known set runs (the engine picks
 *    the one that actually threatens our candidate).
 *  - `variants`: each known set's real spread bundle (ability / item / nature
 *    / EVs / IVs), de-duped. The engine pairs each with the union move pool
 *    and takes the one that's worst for us — real spreads only, no invented
 *    "252 Spe Life Orb Ting-Lu" nonsense.
 * `known:false` means the mon isn't in gen9_filtered.js at all.
 */
export async function threatProfile(displayName) {
  const sets = await allSets(displayName);
  const moves = new Set();
  const abilities = new Set();
  const items = new Set();
  const variants = [];
  const seen = new Set();
  for (const s of sets) {
    (s.moves || []).forEach(m => moves.add(m));
    if (s.ability) abilities.add(s.ability);
    if (s.item) items.add(s.item);
    const key = `${s.ability}|${s.item}|${s.nature}|${JSON.stringify(s.evs)}|${JSON.stringify(s.ivs || {})}`;
    if (!seen.has(key)) {
      seen.add(key);
      variants.push({ name: s.name, ability: s.ability, item: s.item, nature: s.nature, evs: s.evs, ivs: s.ivs });
    }
  }
  return {
    known: sets.length > 0,
    moves: [...moves],
    abilities: [...abilities],
    items: [...items],
    variants,
    hasScarf: items.has('Choice Scarf'),
    hasBooster: items.has('Booster Energy'),
  };
}

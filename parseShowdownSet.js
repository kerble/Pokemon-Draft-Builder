// Parses Pokémon Showdown export text into set bundles the threat model can
// use. Handles one or more sets separated by blank lines. Only the parts the
// engine cares about are kept (ability / item / nature / EVs / IVs / moves);
// Level, Shiny, Happiness, Tera etc. are read but ignored downstream.

const EV_KEY = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe' };

function parseStatLine(str) {
  const out = {};
  for (const part of str.split('/')) {
    const m = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (m) out[EV_KEY[m[2].toLowerCase()]] = Number(m[1]);
  }
  return out;
}

// First line: "Nick (Species) (M) @ Item" | "Species (M) @ Item" | "Species @ Item" | "Species"
function parseHeader(line) {
  let rest = line.trim();
  let item;
  const at = rest.lastIndexOf(' @ ');
  if (at !== -1) { item = rest.slice(at + 3).trim(); rest = rest.slice(0, at).trim(); }
  rest = rest.replace(/\s*\((M|F)\)\s*$/i, '').trim();

  let nickname = null;
  let species = rest;
  const paren = rest.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (paren) { nickname = paren[1].trim() || null; species = paren[2].trim(); }
  return { nickname, species, item: item || undefined };
}

/** rawText -> [{ name, species, ability, item, nature, evs, ivs, teraType, moves }] */
export function parseShowdownSets(rawText) {
  if (!rawText || !rawText.trim()) return [];
  const blocks = rawText.replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const sets = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const set = { evs: {}, ivs: undefined, moves: [], nature: 'Serious' };
    const header = parseHeader(lines[0]);
    set.species = header.species;
    set.item = header.item;
    set.name = `custom: ${header.nickname || header.species}`;

    for (const line of lines.slice(1)) {
      let m;
      if ((m = line.match(/^Ability:\s*(.+)$/i))) set.ability = m[1].trim();
      else if ((m = line.match(/^EVs:\s*(.+)$/i))) set.evs = parseStatLine(m[1]);
      else if ((m = line.match(/^IVs:\s*(.+)$/i))) set.ivs = parseStatLine(m[1]);
      else if ((m = line.match(/^(\w+)\s+Nature$/i))) set.nature = m[1];
      else if ((m = line.match(/^Tera Type:\s*(.+)$/i))) set.teraType = m[1].trim();
      else if ((m = line.match(/^-\s*(.+)$/))) set.moves.push(m[1].trim());
    }
    if (set.moves.length) sets.push(set);
  }
  return sets;
}

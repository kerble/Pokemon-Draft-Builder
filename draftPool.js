import fs from 'fs';
import path from 'path';

const CSV_PATH = path.join(process.cwd(), 'data', 'KDA.csv');

let cached = null;

/**
 * Parses the point-tier draft sheet. Layout quirk: each tier's header label
 * ("19 Points", "18 Points", ...) sits one column LEFT of where that tier's
 * Pokémon names actually start — except "Banned", which lines up directly
 * with its name column. Point value lives at nameCol+1 ("-" means "use the
 * tier's face value"), and a taken/team flag lives at nameCol+2 (ignored).
 */
function parseDraftCsv() {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = raw.split('\n').map(line => line.split(','));

  const headerRow = rows[2];
  const tierCols = [];
  headerRow.forEach((cell, i) => {
    const c = (cell || '').trim();
    if (c === 'Banned') tierCols.push({ nameCol: i, label: c, hasPoints: false });
    else if (/Points?$/.test(c)) tierCols.push({ nameCol: i + 1, label: c, hasPoints: true });
  });

  const mons = new Map(); // name -> points (null for Banned)
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    for (const { nameCol, label, hasPoints } of tierCols) {
      const name = (row[nameCol] || '').trim();
      if (!name) continue;
      let points = null;
      if (hasPoints) {
        const rawVal = (row[nameCol + 1] || '').trim();
        points = (rawVal === '-' || rawVal === '') ? parseInt(label, 10) : parseInt(rawVal, 10);
      }
      if (!mons.has(name)) mons.set(name, points);
    }
  }
  return mons;
}

/**
 * Returns Pokémon names, sorted alphabetically. Banned mons are excluded
 * by default since they aren't actually draftable — pass includeBanned:true
 * to get them too.
 */
export function getDraftPoolNames({ includeBanned = false } = {}) {
  if (!cached) cached = parseDraftCsv();
  return [...cached.entries()]
    .filter(([, points]) => includeBanned || points !== null)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

/** Returns { name, points } pairs — points is null for Banned mons. */
export function getDraftPoolWithPoints() {
  if (!cached) cached = parseDraftCsv();
  return [...cached.entries()]
    .map(([name, points]) => ({ name, points }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

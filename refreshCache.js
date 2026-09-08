// Re-downloads Pokémon Showdown's compiled dex data into .cache/. Run this
// when Showdown ships new moves / learnset changes:  npm run refresh-data
//
// (There is no items.json on Showdown — items come from data/competitiveItems.js.)

import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), '.cache');
const SOURCES = {
  pokedex: 'https://play.pokemonshowdown.com/data/pokedex.json',
  learnsets: 'https://play.pokemonshowdown.com/data/learnsets.json',
  moves: 'https://play.pokemonshowdown.com/data/moves.json',
};

fs.mkdirSync(CACHE_DIR, { recursive: true });

for (const [key, url] of Object.entries(SOURCES)) {
  process.stdout.write(`${key} … `);
  const res = await fetch(url);
  if (!res.ok) { console.log(`FAILED (${res.status})`); continue; }
  const text = await res.text();
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), text);
  console.log(`${(text.length / 1024 / 1024).toFixed(1)} MB`);
}
console.log('done — restart the server to pick up the new data.');

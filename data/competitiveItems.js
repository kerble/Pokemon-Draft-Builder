// Curated list of competitively relevant Gen 9 singles items, grouped by
// role. Showdown's full item table is ~600 entries (evolution stones, Poké
// Balls, gen-specific junk); this is the slice that actually shows up on
// draft-league sets. Names must match @smogon/calc's ITEMS[9] exactly —
// pokemonData.js drops anything that doesn't and logs it.
//
// Mega stones are intentionally omitted: in this draft pool a Mega is drafted
// as its own entry ("Mega Diancie"), so the candidate is already the mega
// forme and the stone is implied. Opponent sets from gen9_filtered.js still
// carry their own stone strings straight into the calc.

export const COMPETITIVE_ITEMS = [
  // ── Choice ────────────────────────────────────────────────────────────
  'Choice Band', 'Choice Specs', 'Choice Scarf',

  // ── All-purpose offense ───────────────────────────────────────────────
  'Life Orb', 'Expert Belt', 'Muscle Band', 'Wise Glasses', 'Shell Bell',
  'Punching Glove', 'Loaded Dice', 'Scope Lens', 'Razor Claw', 'Wide Lens',
  'Zoom Lens', 'Metronome', 'Bright Powder', 'Quick Claw', "King's Rock",

  // ── All-purpose defense / utility ─────────────────────────────────────
  'Leftovers', 'Black Sludge', 'Rocky Helmet', 'Assault Vest', 'Eviolite',
  'Heavy-Duty Boots', 'Air Balloon', 'Safety Goggles', 'Protective Pads',
  'Covert Cloak', 'Clear Amulet', 'Ability Shield', 'Mirror Herb',
  'Mental Herb', 'White Herb', 'Utility Umbrella', 'Big Root',

  // ── Reactive / momentum ──────────────────────────────────────────────
  'Weakness Policy', 'Booster Energy', 'Throat Spray', 'Blunder Policy',
  'Room Service', 'Adrenaline Orb', 'Eject Button', 'Eject Pack', 'Red Card',
  'Cell Battery', 'Absorb Bulb', 'Snowball', 'Luminous Moss',

  // ── Status / field ──────────────────────────────────────────────────
  'Flame Orb', 'Toxic Orb', 'Light Clay', 'Terrain Extender', 'Damp Rock',
  'Heat Rock', 'Smooth Rock', 'Icy Rock', 'Focus Sash', 'Focus Band',
  'Iron Ball', 'Lagging Tail', 'Sticky Barb', 'Grip Claw',
  'Electric Seed', 'Grassy Seed', 'Misty Seed', 'Psychic Seed',

  // ── Signature ───────────────────────────────────────────────────────
  'Rusted Sword', 'Rusted Shield', 'Griseous Core', 'Adamant Crystal',
  'Lustrous Globe', 'Cornerstone Mask', 'Wellspring Mask', 'Hearthflame Mask',

  // ── Type-boost (1.2x) ───────────────────────────────────────────────
  'Silk Scarf', 'Charcoal', 'Mystic Water', 'Magnet', 'Miracle Seed',
  'Never-Melt Ice', 'Black Belt', 'Poison Barb', 'Soft Sand', 'Sharp Beak',
  'Twisted Spoon', 'Silver Powder', 'Hard Stone', 'Spell Tag', 'Dragon Fang',
  'Black Glasses', 'Metal Coat', 'Fairy Feather',

  // ── Pinch berries ───────────────────────────────────────────────────
  'Liechi Berry', 'Petaya Berry', 'Salac Berry', 'Custap Berry', 'Micle Berry',
  'Starf Berry', 'Lansat Berry',

  // ── Healing / status berries ────────────────────────────────────────
  'Sitrus Berry', 'Oran Berry', 'Berry Juice', 'Lum Berry', 'Aguav Berry',
  'Figy Berry', 'Iapapa Berry', 'Mago Berry', 'Wiki Berry', 'Cheri Berry',
  'Chesto Berry', 'Pecha Berry', 'Rawst Berry', 'Aspear Berry', 'Persim Berry',

  // ── Type-resist berries ─────────────────────────────────────────────
  'Occa Berry', 'Passho Berry', 'Wacan Berry', 'Rindo Berry', 'Yache Berry',
  'Chople Berry', 'Kebia Berry', 'Shuca Berry', 'Coba Berry', 'Payapa Berry',
  'Tanga Berry', 'Charti Berry', 'Kasib Berry', 'Haban Berry', 'Colbur Berry',
  'Babiri Berry', 'Chilan Berry', 'Roseli Berry',
];

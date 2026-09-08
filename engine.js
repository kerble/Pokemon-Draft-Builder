import pkg from '@smogon/calc';
import { speciesData, resolveSpecies } from './names.js';
import { threatProfile } from './setdex.js';
import { getDraftPoolWithPoints } from './draftPool.js';
import { parseShowdownSets } from './parseShowdownSet.js';

const { calculate, Generations, Pokemon, Move } = pkg;
const gen = Generations.get(9);
const LEVEL = 100;

// How much a matchup counts toward the set's score. Draft-league opponents
// bring 6 of their pool, and the pricey mons are the ones you'll actually
// face — so beating a 19-point Ting-Lu matters far more than a 2-point
// Spiritomb. Raw point cost (fallback 8 for anything not in KDA.csv).
let POINTS = null;
function relevance(displayName) {
  if (!POINTS) {
    POINTS = new Map();
    try { for (const { name, points } of getDraftPoolWithPoints()) POINTS.set(name, points); } catch { /* csv missing */ }
  }
  const p = POINTS.get(displayName);
  return p == null ? 8 : p;
}

// A win's worth before point-weighting: KO cleanliness minus a super-linear
// boost tax (a set that needs +3 is far worse than one that needs +1, not
// just 3x worse — three Calm Minds rarely happen). A loss is a real minus so
// the search still prefers converting one.
const QUALITY_VALUE = { clean: 1.0, favorable: 0.88, risky: 0.72 };
const BOOST_TAX = [0, 0.3, 0.62, 1.0];
function matchupValue(won, stage, quality) {
  if (!won) return -0.5;
  return Math.max(0.03, QUALITY_VALUE[quality] - BOOST_TAX[stage]);
}

// Stat boosts each setup move grants per use. Stage s multiplies these,
// clamped to +/-6. Kept in sync with the picker-less "auto-detect a boosting
// move in the selected pool" flow.
export const BOOST_TABLE = {
  'Dragon Dance':  { atk: 1, spe: 1 },
  'Swords Dance':  { atk: 2 },
  'Nasty Plot':    { spa: 2 },
  'Calm Mind':     { spa: 1, spd: 1 },
  'Quiver Dance':  { spa: 1, spd: 1, spe: 1 },
  'Bulk Up':       { atk: 1, def: 1 },
  'Coil':          { atk: 1, def: 1 },
  'Agility':       { spe: 2 },
  'Rock Polish':   { spe: 2 },
  'Shell Smash':   { atk: 2, spa: 2, spe: 2, def: -1, spd: -1 },
  'Growth':        { atk: 1, spa: 1 },
  'Curse':         { atk: 1, def: 1, spe: -1 },
  'Victory Dance': { atk: 1, def: 1, spe: 1 },
  'Tidy Up':       { atk: 1, spe: 1 },
  'Work Up':       { atk: 1, spa: 1 },
  'Howl':          { atk: 1 },
  'Meditate':      { atk: 1 },
  'Iron Defense':  { def: 2 },
  'Acid Armor':    { def: 2 },
  'Autotomize':    { spe: 2 },
};

const STATS6 = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const MAX_STAGE = 3;
const CONFIG_CAP = 6000;

// Pivot / self-switch moves — using one ends the sweep attempt, so they're
// never candidate attackers for a win-con set even if the user checks them.
const PIVOT_MOVES = new Set([
  'U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Chilly Reception',
  'Teleport', 'Baton Pass', 'Shed Tail',
]);

// Representative STAB moves for opponents missing from the sets file, so the
// calc still gets real type + category + BP. phys/spec chosen by the mon's
// higher attacking stat.
const TYPE_MOVE = {
  Normal:   { phys: 'Body Slam',      spec: 'Hyper Voice' },
  Fire:     { phys: 'Flare Blitz',    spec: 'Flamethrower' },
  Water:    { phys: 'Waterfall',      spec: 'Surf' },
  Electric: { phys: 'Wild Charge',    spec: 'Thunderbolt' },
  Grass:    { phys: 'Power Whip',     spec: 'Energy Ball' },
  Ice:      { phys: 'Icicle Crash',   spec: 'Ice Beam' },
  Fighting: { phys: 'Close Combat',   spec: 'Aura Sphere' },
  Poison:   { phys: 'Gunk Shot',      spec: 'Sludge Bomb' },
  Ground:   { phys: 'Earthquake',     spec: 'Earth Power' },
  Flying:   { phys: 'Brave Bird',     spec: 'Air Slash' },
  Psychic:  { phys: 'Zen Headbutt',   spec: 'Psychic' },
  Bug:      { phys: 'U-turn',         spec: 'Bug Buzz' },
  Rock:     { phys: 'Stone Edge',     spec: 'Power Gem' },
  Ghost:    { phys: 'Poltergeist',    spec: 'Shadow Ball' },
  Dragon:   { phys: 'Outrage',        spec: 'Draco Meteor' },
  Dark:     { phys: 'Knock Off',      spec: 'Dark Pulse' },
  Steel:    { phys: 'Iron Head',      spec: 'Flash Cannon' },
  Fairy:    { phys: 'Play Rough',     spec: 'Moonblast' },
};

// Items that make a setup move unusable: Choice items lock you into the
// first move clicked, Assault Vest blocks status moves outright. With any of
// them the candidate can never get a boost off, so the search is pinned to
// stage 0.
const NO_SETUP_ITEMS = new Set(['Choice Band', 'Choice Specs', 'Choice Scarf', 'Assault Vest']);
function maxStageFor(item) { return NO_SETUP_ITEMS.has(item) ? 0 : MAX_STAGE; }

function clampStage(v) { return Math.max(-6, Math.min(6, v)); }

function boostsAtStage(boostSpec, stage) {
  if (!boostSpec || stage === 0) return {};
  const out = {};
  for (const [k, v] of Object.entries(boostSpec)) out[k] = clampStage(v * stage);
  return out;
}

// pokemon.stats.spe already has nature/EV/IV baked in. Layer on the runtime
// speed multipliers the user cares about: Choice Scarf, a speed boost stage,
// and Booster Energy / Protosynthesis / Quark Drive when speed is the mon's
// top stat. Paralysis, Tailwind, weather-speed abilities are out of scope.
function finalSpeed(mon, item, ability, speStage) {
  let spe = mon.stats.spe;
  if (speStage) spe = Math.floor(spe * (speStage > 0 ? (2 + speStage) / 2 : 2 / (2 - speStage)));
  if (item === 'Choice Scarf') spe = Math.floor(spe * 1.5);
  const boosterAbility = ability === 'Protosynthesis' || ability === 'Quark Drive';
  if (item === 'Booster Energy' && boosterAbility) {
    const top = Math.max(mon.stats.atk, mon.stats.def, mon.stats.spa, mon.stats.spd, mon.stats.spe);
    if (mon.stats.spe === top) spe = Math.floor(spe * 1.5);
  }
  return spe;
}

function koTurns(pct) {
  if (pct >= 100) return 1;
  if (pct * 2 >= 100) return 2;
  return null; // slower than a 2HKO — not a sweep move
}

function natureFor(physLean, speedInvested) {
  if (physLean) return speedInvested ? 'Jolly' : 'Adamant';
  return speedInvested ? 'Timid' : 'Modest';
}

function* kCombos(arr, k) {
  if (k > arr.length) { yield arr.slice(); return; }
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map(i => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === arr.length - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function evSpreads(evs, evValues) {
  const base = {};
  const explore = [];
  for (const stat of STATS6) {
    const mode = evs?.[stat] ?? 'skip';
    if (mode === 'lock') base[stat] = evValues?.[stat] || 0;
    else if (mode === 'explore') explore.push(stat);
    else base[stat] = 0;
  }
  const out = [];
  const n = explore.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    const spread = { ...base };
    for (let b = 0; b < n; b++) spread[explore[b]] = (mask >> b) & 1 ? 252 : 0;
    const total = STATS6.reduce((s, k) => s + (spread[k] || 0), 0);
    if (total > 508) continue;
    out.push(spread);
  }
  return out.length ? out : [base];
}

// Opponent model: for each mon, the *union* of every damaging move it runs
// on any known set, paired with the *real* spread bundles (ability / item /
// nature / EVs / IVs) from those sets — the engine picks the move that
// threatens our candidate most and the spread that's worst for us, but never
// invents a spread. So a Ting-Lu buried in utility sets still gets its
// bulkiest real spread + Throat Chop from a coverage set, and a "specially
// defensive" Sandslash can't hide its real offensive Swords Dance spread.
async function opponentProfile(displayName) {
  const prof = await threatProfile(displayName);
  const sp = speciesData(displayName);
  if (prof.known) return { prof, sp };

  if (!sp) return { prof, sp: null };
  // Not in gen9_filtered.js — no real spreads to borrow, so synthesise a
  // minimal offensive + bulky pair from base stats (flagged in the report).
  const moves = (sp.types || []).flatMap(t => {
    const pair = TYPE_MOVE[t];
    return pair ? [pair.phys, pair.spec] : [];
  });
  const physical = sp.baseStats.atk >= sp.baseStats.spa;
  const ability = Object.values(sp.abilities)[0];
  const variants = [
    { name: 'assumed offensive', ability, item: 'Life Orb', nature: physical ? 'Adamant' : 'Modest', evs: { [physical ? 'atk' : 'spa']: 252, spe: 252 } },
    { name: 'assumed bulky', ability, item: 'Leftovers', nature: 'Careful', evs: { hp: 252, spd: 252 } },
  ];
  return {
    prof: { known: false, moves, abilities: [ability], items: [], variants, hasScarf: false, hasBooster: false },
    sp,
  };
}

function evShort(evs) {
  return STATS6.filter(k => evs[k]).map(k => `${evs[k]} ${k}`).join('/');
}

/**
 * Churns candidate move/item/EV/nature/ability/boost-stage combinations and
 * returns the one that beats the most of the opponent draft 1v1, plus the
 * per-opponent breakdown and a few runner-up configs.
 *
 * Win rule: our best move must KO in <=2 hits at max roll, and we must
 * survive the opponent's hits at max roll given who moves first (Scarf,
 * boost-stage speed, Booster Energy factored). No chip, no hazards. A speed
 * tie counts as us moving second.
 */
export async function evaluate(input) {
  const {
    opponentDraft = [], candidate,
    selectedMoves = [], lockedMoves = [],
    evs = {}, evValues = {}, selectedItems = [],
    manualSets = {}, removedThreats = {},
  } = input;

  const canon = resolveSpecies(candidate);
  if (!canon) throw new Error(`could not resolve candidate species: ${candidate}`);
  const sp = speciesData(candidate);
  const isMega = /-Mega(-[XY])?$/.test(canon) || String(sp.forme || '').startsWith('Mega') || !!sp.requiredItem;

  // Per-request caches / counters.
  const calcCache = new Map();
  let matchupsTested = 0;

  function dmgPct(attacker, defender, moveName, key) {
    if (calcCache.has(key)) return calcCache.get(key);
    let out = { max: 0, min: 0 };
    try {
      const res = calculate(gen, attacker, defender, new Move(gen, moveName));
      const [lo, hi] = res.range();
      const hp = defender.maxHP();
      out = { max: (hi / hp) * 100, min: (lo / hp) * 100 };
    } catch { /* out stays 0 */ }
    calcCache.set(key, out);
    return out;
  }

  // Every connecting move in `moveNames` vs `defender`: {move, pct, min, priority}.
  function hitList(attacker, attackerKey, defender, defenderKey, moveNames) {
    const out = [];
    for (const name of moveNames) {
      let mv;
      try { mv = new Move(gen, name); } catch { continue; }
      if (mv.category === 'Status') continue;
      const d = dmgPct(attacker, defender, name, `${attackerKey}>${defenderKey}>${name}`);
      if (d.max <= 0) continue;
      out.push({ move: name, pct: d.max, min: d.min, priority: mv.priority });
    }
    return out;
  }

  // Highest-damage connecting move — used for the opponent's hit back.
  function bestHit(attacker, attackerKey, defender, defenderKey, moveNames) {
    let best = null;
    for (const h of hitList(attacker, attackerKey, defender, defenderKey, moveNames)) {
      if (!best || h.pct > best.pct) best = h;
    }
    return best;
  }

  // "guaranteed" / "83% roll" / "high roll only" for a KO in `turns` hits.
  function rollNote(pctMax, pctMin, turns) {
    const need = 100 / turns;
    if (pctMin >= need) return 'guaranteed';
    if (pctMax < need) return null;
    const frac = (pctMax - need) / (pctMax - pctMin);
    const pctRolls = Math.round(frac * 100);
    if (pctRolls >= 80) return `${pctRolls}% roll`;
    if (pctRolls >= 25) return `${pctRolls}% roll`;
    return `${pctRolls}% roll — high roll only`;
  }

  // A locked move is implicitly selected — the UI now enforces this, but be
  // defensive so a star-without-check can't silently drop the setup move
  // (which was making every "needs Calm Mind" matchup evaluate at +0).
  const lockedSet = new Set(lockedMoves);
  const selected = [...new Set([...selectedMoves, ...lockedMoves])];

  const boostMove = selected.find(m => BOOST_TABLE[m]) || null;
  const boostSpec = boostMove ? BOOST_TABLE[boostMove] : null;

  const attackingPool = selected.filter(m => {
    if (m === boostMove || PIVOT_MOVES.has(m)) return false;
    try { return new Move(gen, m).category !== 'Status'; } catch { return false; }
  });
  if (attackingPool.length === 0) throw new Error('no attacking moves selected (pivot/status moves are ignored)');

  // With a setup move the set is boost + 3 attacks; without one it's 4 attacks.
  const moveSlots = boostMove ? 3 : 4;
  const lockedAttackers = attackingPool.filter(m => lockedSet.has(m));
  const freeAttackers = attackingPool.filter(m => !lockedSet.has(m));
  const slots = Math.max(0, moveSlots - lockedAttackers.length);
  const moveCombos = [];
  if (attackingPool.length <= moveSlots) {
    moveCombos.push(attackingPool.slice());
  } else if (slots === 0) {
    moveCombos.push(lockedAttackers.slice(0, moveSlots));
  } else {
    for (const combo of kCombos(freeAttackers, Math.min(slots, freeAttackers.length))) {
      moveCombos.push([...lockedAttackers, ...combo]);
    }
  }

  // A Mega is drafted as its own forme, so the candidate species is already
  // mega'd in the calc and the held stone does nothing — force "no item".
  const items = isMega ? [undefined] : (selectedItems.length ? selectedItems : [undefined]);
  const spreads = evSpreads(evs, evValues);
  const abilities = Object.values(sp.abilities);

  const physBP = attackingPool.reduce((s, m) => { try { const mv = new Move(gen, m); return s + (mv.category === 'Physical' ? mv.bp : 0); } catch { return s; } }, 0);
  const specBP = attackingPool.reduce((s, m) => { try { const mv = new Move(gen, m); return s + (mv.category === 'Special' ? mv.bp : 0); } catch { return s; } }, 0);

  // Pre-resolve each opponent's threat profile once.
  const oppData = [];
  for (const mon of opponentDraft) {
    const { prof, sp: oppSp } = await opponentProfile(mon);

    // User-supplied sets (Showdown export text) for this mon — additive.
    // Their moves join the threat union; the spread joins the variant list.
    // If the mon had no set data at all, a pasted set replaces the STAB guess.
    const extra = parseShowdownSets(manualSets[mon] || '');
    if (extra.length) {
      if (!prof.known) { prof.variants = []; prof.known = true; }
      for (const e of extra) {
        (e.moves || []).forEach(m => { if (!prof.moves.includes(m)) prof.moves.push(m); });
        prof.variants.push({ name: e.name, ability: e.ability, item: e.item, nature: e.nature || 'Serious', evs: e.evs || {}, ivs: e.ivs, custom: true });
      }
    }

    // Moves the user dropped in step 6 (Hyper Beam off a 1v1 set, etc.).
    const dropped = new Set(removedThreats[mon] || []);
    const damaging = prof.moves.filter(m => {
      if (dropped.has(m)) return false;
      try { return new Move(gen, m).category !== 'Status'; } catch { return false; }
    });
    oppData.push({ mon, prof, sp: oppSp, damaging, variants: prof.variants });
  }

  const configs = [];
  for (const spread of spreads) {
    const speedInvested = (spread.spe || 0) >= 252 || (evs.spe === 'lock' && (evValues.spe || 0) > 0);
    const natureList = new Set([natureFor(physBP >= specBP, false)]);
    if (speedInvested) natureList.add(natureFor(physBP >= specBP, true));
    for (const nature of natureList) {
      for (const ability of abilities) {
        for (const item of items) {
          for (const moves of moveCombos) {
            configs.push({ spread, nature, ability, item, moves });
          }
        }
      }
    }
  }
  const truncated = configs.length > CONFIG_CAP;
  const searchConfigs = truncated ? configs.slice(0, CONFIG_CAP) : configs;

  function candPokemon(cfg, stage, side) {
    const opts = {
      level: LEVEL, item: cfg.item, ability: cfg.ability,
      nature: cfg.nature, evs: cfg.spread,
    };
    if (side === 'atk') {
      const b = boostsAtStage(boostSpec, stage);
      opts.boosts = { atk: b.atk || 0, spa: b.spa || 0, spe: b.spe || 0 };
    } else {
      const b = boostsAtStage(boostSpec, stage);
      opts.boosts = { def: b.def || 0, spd: b.spd || 0, spe: b.spe || 0 };
    }
    return new Pokemon(gen, canon, opts);
  }

  const varDefCache = new Map();
  function varKey(oppMon, v) {
    return `${oppMon}|${v.name}|${v.ability}|${v.nature}|${JSON.stringify(v.evs)}|${JSON.stringify(v.ivs || {})}|${v.item}`;
  }
  function makeVariantDefender(oppMon, v) {
    const key = varKey(oppMon, v);
    if (varDefCache.has(key)) return varDefCache.get(key);
    const species = resolveSpecies(oppMon) || oppMon;
    const opts = { level: LEVEL, item: v.item, ability: v.ability, nature: v.nature, evs: v.evs, ivs: v.ivs };
    let d;
    try { d = new Pokemon(gen, species, opts); }
    catch { d = new Pokemon(gen, species, { ...opts, item: undefined }); }
    varDefCache.set(key, d);
    return d;
  }

  // How good a per-move matchup outcome is *for us* — used to pick which of
  // our moves to actually click. A win beats a loss; among wins, cleaner and
  // fewer hits taken and a faster KO; among losses, closer to a KO. This is
  // why a +1-priority Jet Punch gets picked over a stronger Flip Turn when
  // we're slower and the stronger move would eat a hit first.
  function outcomeScore(o) {
    if (o.win) {
      return 5e9
        - QUALITY_RANK[o.quality] * 1e7
        - (o.hitsTaken || 0) * 1e6
        - (o.ourKO - 1) * 1e5
        + Math.min(300, o.ours.pct) * 100;
    }
    return Math.min(300, o.ours?.pct ?? 0);
  }

  // One matchup: does `moveNames` beat this opponent set-spread `v` at `stage`?
  // Tries each of our moves and keeps whichever gives the best outcome for us.
  function judge(cfg, stage, oppMon, v, defender, oppMoves, moveNames) {
    const cfgKey = `${cfg.item}|${cfg.ability}|${cfg.nature}|${JSON.stringify(cfg.spread)}`;
    const defKey = varKey(oppMon, v);
    const atk = candPokemon(cfg, stage, 'atk');
    const dfn = candPokemon(cfg, stage, 'def');
    const oursList = hitList(atk, `${canon}|${cfgKey}|s${stage}`, defender, defKey, moveNames);
    const theirs = bestHit(defender, defKey, dfn, `${canon}|${cfgKey}|s${stage}`, oppMoves);
    const theirPct = theirs ? theirs.pct : 0;
    const theirPrio = theirs?.priority ?? 0;

    const b = boostsAtStage(boostSpec, stage);
    const ourSpe = finalSpeed(atk, cfg.item, cfg.ability, b.spe || 0);
    const theirSpe = finalSpeed(defender, v.item, v.ability, 0);

    let picked = null;
    for (const ours of oursList.length ? oursList : [null]) {
      const ourPrio = ours?.priority ?? -9;
      const weFirst = ourPrio > theirPrio ? true
        : theirPrio > ourPrio ? false
        : ourSpe > theirSpe; // speed tie => we move second
      const ourKO = ours ? koTurns(ours.pct) : null;
      const hitsTaken = ourKO == null ? null : (weFirst ? ourKO - 1 : ourKO);
      const dmgIn = hitsTaken == null ? null : (hitsTaken === 0 ? 0 : theirPct * hitsTaken);
      const win = ourKO != null && dmgIn < 100;
      const quality = !win ? null : dmgIn === 0 ? 'clean' : dmgIn < 50 ? 'favorable' : 'risky';
      let margin = 0;
      if (win) {
        const offMargin = Math.min(ours.pct, 250);
        const defMargin = hitsTaken === 0 ? 100 : (100 - dmgIn);
        margin = offMargin + Math.max(0, defMargin) / 4;
      }
      const cand = { win, quality, margin, stage, ours, theirs, theirPct, ourKO, hitsTaken, dmgIn, weFirst, ourSpe, theirSpe, v };
      if (!picked || outcomeScore(cand) > outcomeScore(picked)) picked = cand;
    }
    return picked;
  }

  const QUALITY_RANK = { clean: 0, favorable: 1, risky: 2 };
  // Higher = worse for us, deciding which opponent spread the card names.
  // Order: a loss beats any win; then more hits to KO (a spread that eats
  // two of our hits stalls the sweep more than one we OHKO); then the
  // spread we do the *least* to (closest to needing another boost — this is
  // why a Psyshock user's worst case is the physically-defensive set, not
  // the specially-defensive one); then KO quality and damage taken.
  const worseRank = j => {
    if (!j.win) return 4e9;
    const koTurns = j.ourKO || 3;
    const weak = Math.max(0, 300 - (j.ours?.pct ?? 0));
    return koTurns * 1e7 + weak * 1e3 + QUALITY_RANK[j.quality] * 1e2 + (j.dmgIn || 0);
  };

  // Lowest boost stage at which `moveNames` beats the opponent's *worst-for-us*
  // real spread (union move pool + each set's spread bundle). `count` bumps
  // the counter — off for the saver-move probes.
  function stageToBeatWith(cfg, oppEntry, moveNames, count) {
    const { mon, prof, damaging, variants } = oppEntry;
    const cap = boostSpec ? maxStageFor(cfg.item) : 0;
    let lastLoss = null;
    for (let stage = 0; stage <= cap; stage++) {
      let worstWin = null;    // hardest spread to break — what the card names
      let scoreQ = 'clean';   // least-clean win across spreads — what scoring pays for
      let scoreMargin = Infinity;
      let loss = null;
      for (const v of variants) {
        if (count) matchupsTested++;
        const defender = makeVariantDefender(mon, v);
        const j = judge(cfg, stage, mon, v, defender, damaging, moveNames);
        if (!j.win) { loss = j; break; }
        if (!worstWin || worseRank(j) > worseRank(worstWin)) worstWin = j;
        if (QUALITY_RANK[j.quality] > QUALITY_RANK[scoreQ]) scoreQ = j.quality;
        scoreMargin = Math.min(scoreMargin, j.margin);
      }
      if (!loss) return { won: true, stage, quality: scoreQ, margin: scoreMargin, j: worstWin };
      lastLoss = { j: loss, stage };
    }
    return { won: false, lastLoss, fallback: !prof.known };
  }

  function describeWin(j) {
    const order = j.weFirst ? `outspeeds ${j.ourSpe}>${j.theirSpe}` : `slower ${j.ourSpe}<${j.theirSpe}`;
    const koTxt = j.ourKO === 1 ? 'OHKO' : '2HKO';
    const prio = j.ours.priority > 0 ? ` +${j.ours.priority} prio` : '';
    const total = j.hitsTaken > 1 ? ` = ${(j.theirPct * j.hitsTaken).toFixed(0)}%` : '';
    const back = (!j.theirs || j.dmgIn === 0)
      ? "can't meaningfully damage back"
      : `eats ${j.hitsTaken}x ${j.theirs.move} (${j.theirPct.toFixed(0)}%${total})`;
    return `vs worst-case [${j.v.name}]: ${j.ours.move} ${koTxt} ${j.ours.pct.toFixed(0)}%${prio}; ${order}; ${back}`;
  }

  // Why the chosen moves can't beat this mon. `deep` also reports whether a
  // move cut from the set would have — only run for the final pick.
  function missNote(cfg, oppEntry, res, deep) {
    const { j, stage } = res.lastLoss;
    const a = j.v;
    const spread = `${evShort(a.evs)}${a.nature ? ' ' + a.nature : ''}${a.item ? ' ' + a.item : ''}`;
    const at = stage > 0 ? ` (+${stage})` : '';
    const tag = res.fallback ? ' [no set data — STAB assumed]' : '';

    let reason;
    if (!j.ours) {
      reason = `nothing we run dents [${a.name}] ${spread}${at}`;
    } else if (j.ourKO == null) {
      reason = `[${a.name}] ${spread} survives — ${j.ours.move} only ${j.ours.pct.toFixed(0)}%${at}, not a 2HKO`;
    } else if (!j.theirs) {
      reason = `can't break [${a.name}] ${spread} fast enough${at}`;
    } else {
      const order = j.weFirst ? `we're faster but` : `outsped ${j.ourSpe}<${j.theirSpe},`;
      const total = j.hitsTaken > 1 ? ` x${j.hitsTaken}=${(j.theirPct * j.hitsTaken).toFixed(0)}%` : '';
      const koTxt = (j.ourKO === 1 ? 'OHKO' : '2HKO').toLowerCase();
      reason = `loses to [${a.name}] ${j.theirs.move} (${spread}): ${order} ${j.theirs.move} ${j.theirPct.toFixed(0)}%${total} vs our ${j.ours.move} ${koTxt}${at}`;
    }

    if (deep) {
      const cut = attackingPool.filter(m => !cfg.moves.includes(m));
      let saver = null;
      for (const m of cut) {
        const r = stageToBeatWith(cfg, oppEntry, [m], false);
        if (r.won) { saver = { move: m, stage: r.stage }; break; }
      }
      if (saver) reason += ` — ${saver.move} (cut from this set) beats it${saver.stage > 0 ? ` at +${saver.stage}` : ''}`;
    }
    return reason + tag;
  }

  // Full 0..cap ladder for one matchup — every stage's worst-case outcome,
  // structured for the card + the +0/+1/+2/+3 toggle. Runs all variants at
  // all stages (no early break), so it's only built for the final pick.
  function worseOf(a, b) {
    if (!a) return b;
    return worseRank(b) > worseRank(a) ? b : a;
  }

  function ladderFor(cfg, oppEntry) {
    const { mon, damaging, variants } = oppEntry;
    const cap = boostSpec ? maxStageFor(cfg.item) : 0;
    const rungs = [];
    for (let stage = 0; stage <= cap; stage++) {
      let worst = null;
      for (const v of variants) {
        const defender = makeVariantDefender(mon, v);
        worst = worseOf(worst, judge(cfg, stage, mon, v, defender, damaging, cfg.moves));
      }
      rungs.push(rungFrom(worst));
    }
    return rungs;
  }

  function rungFrom(j) {
    const koTxt = j.ourKO === 1 ? 'OHKO' : j.ourKO === 2 ? '2HKO' : '3HKO+';
    const order = j.weFirst ? `faster (${j.ourSpe} vs ${j.theirSpe})` : `slower (${j.ourSpe} vs ${j.theirSpe})`;
    const you = j.ours
      ? `${j.ours.move} — ${j.ours.pct.toFixed(0)}% max (${koTxt})`
      : 'no move connects';
    const roll = j.ours && j.ourKO ? rollNote(j.ours.pct, j.ours.min, j.ourKO) : null;

    let them;
    if (!j.theirs || j.theirPct === 0) {
      them = 'no damage back';
    } else if (j.hitsTaken == null) {
      // we never KO in <=2 — they get to keep hitting
      them = `${j.theirs.move} — ${j.theirPct.toFixed(0)}% max, and we can't KO fast enough`;
    } else if (j.hitsTaken === 0) {
      them = `${j.theirs.move} — ${j.theirPct.toFixed(0)}% (never lands, we move first)`;
    } else {
      const stacked = j.hitsTaken > 1 ? ` ×${j.hitsTaken} = ${(j.theirPct * j.hitsTaken).toFixed(0)}%` : '';
      const tail = j.win ? ' — survived' : (j.weFirst ? ' — KOs us back' : ' — KOs us first');
      them = `${j.theirs.move} — ${j.theirPct.toFixed(0)}%${stacked}${tail}`;
    }

    return {
      stage: j.stage,
      won: j.win,
      quality: j.quality,
      workMove: j.ours?.move || null,
      you, them, roll, order,
      threat: j.v.name,
      threatSpread: `${evShort(j.v.evs)}${j.v.nature ? ' ' + j.v.nature : ''}${j.v.item ? ' @ ' + j.v.item : ''}`.trim(),
    };
  }

  function scoreConfig(cfg, rich = false) {
    const per = [];
    let beats = 0, sumBoosts = 0, maxBoosts = 0, margin = 0, cleanCount = 0, score = 0;
    const offEV = (cfg.spread.atk || 0) + (cfg.spread.spa || 0) + (cfg.spread.spe || 0);
    for (const oppEntry of oppData) {
      const mon = oppEntry.mon;
      const w = relevance(mon);
      if (!oppEntry.sp && !oppEntry.prof.known) {
        per.push({ opponent: mon, points: POINTS.get(mon) ?? null, result: 'unknown', boostsNeeded: null, quality: null, threat: null, note: 'no species data' });
        continue;
      }
      const r = stageToBeatWith(cfg, oppEntry, cfg.moves, true);
      if (r.won) {
        beats++; sumBoosts += r.stage; maxBoosts = Math.max(maxBoosts, r.stage);
        margin += r.margin;
        if (r.quality === 'clean') cleanCount++;
        score += w * matchupValue(true, r.stage, r.quality);
        per.push({ opponent: mon, points: POINTS.get(mon) ?? null, result: 'win', boostsNeeded: r.stage, quality: r.quality, threat: r.j.v.name, note: describeWin(r.j) });
      } else {
        score += w * matchupValue(false);
        per.push({ opponent: mon, points: POINTS.get(mon) ?? null, result: 'loss', boostsNeeded: null, quality: null, threat: r.lastLoss.j.v.name, note: missNote(cfg, oppEntry, r, rich) });
      }
    }
    // Heaviest opponents first in the grid — that's where the reader looks.
    per.sort((a, b) => (b.points ?? 8) - (a.points ?? 8));
    return { cfg, beats, sumBoosts, maxBoosts, margin, offEV, cleanCount, score, per };
  }

  let scored = searchConfigs.map(c => scoreConfig(c));
  scored.sort((a, b) =>
    b.score - a.score ||          // point-weighted, boost-taxed value
    b.beats - a.beats ||
    a.sumBoosts - b.sumBoosts ||
    b.margin - a.margin ||
    b.offEV - a.offEV
  );
  const matchupsFromSearch = matchupsTested;
  // Re-score the winner with deep miss notes (which move, cut from the set,
  // would have flipped each loss) — too expensive to run for every config.
  if (scored.length) scored[0] = scoreConfig(scored[0].cfg, true);

  const fmt = c => ({
    moves: c.cfg.moves,
    boostMove,
    droppedMoves: attackingPool.filter(m => !c.cfg.moves.includes(m)),
    item: c.cfg.item || null,
    ability: c.cfg.ability,
    nature: c.cfg.nature,
    evs: Object.fromEntries(STATS6.map(s => [s, c.cfg.spread[s] || 0]).filter(([, v]) => v > 0)),
    beats: c.beats,
    total: opponentDraft.length,
    maxBoostsUsed: c.maxBoosts,
    cleanCount: c.cleanCount,
    score: Math.round(c.score * 10) / 10,
  });

  const best = scored[0];

  // Attach the per-stage ladder to the winning config's matchups (search
  // used the cheap early-return path; this is the only full-ladder pass).
  const byMon = new Map(oppData.map(o => [o.mon, o]));
  for (const p of best.per) {
    const oppEntry = byMon.get(p.opponent);
    if (!oppEntry) continue;
    p.ladder = ladderFor(best.cfg, oppEntry);
    const view = p.ladder.find(r => r.won) || p.ladder[p.ladder.length - 1];
    if (view) {
      p.you = view.you;
      p.them = view.them;
      p.roll = view.roll;
      p.order = view.order;
      p.workMove = view.workMove;
      p.threat = view.threat;
      p.threatSpread = view.threatSpread;
      if (view.won) p.quality = view.quality; // card matches its ladder rung
    }
  }

  return {
    candidate: canon,
    total: opponentDraft.length,
    boostMove,
    boostCap: boostSpec ? maxStageFor(best.cfg.item) : 0,
    truncated,
    isMega,
    megaStone: isMega ? (sp.requiredItem || null) : null,
    stats: {
      setsChecked: searchConfigs.length,
      matchupsTested: matchupsFromSearch,
      damageCalcs: calcCache.size,
    },
    best: { ...fmt(best), perOpponent: best.per },
    alternatives: dedupe(scored.slice(1)).slice(0, 4).map(fmt),
  };
}

function dedupe(scoredList) {
  const seen = new Set();
  const out = [];
  for (const c of scoredList) {
    const k = `${c.cfg.item}|${c.cfg.ability}|${c.cfg.nature}|${c.cfg.moves.slice().sort().join(',')}|${JSON.stringify(c.cfg.spread)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

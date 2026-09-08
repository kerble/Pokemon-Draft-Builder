# Draft Buildbot — Win-Con Finder

## What's real
- `data/KDA.csv` → parsed by `draftPool.js` → powers `/api/draft-pool`
  (1,144 draftable mons, Banned tier excluded, alphabetical)
- `pokemonData.js` → fetches Pokémon Showdown's own compiled dex data
  (`pokedex.json`, `learnsets.json`, `moves.json` from
  `play.pokemonshowdown.com/data/`) the first time a movepool is requested,
  and caches it to `.cache/` so it's instant after that. Powers
  `/api/movepool/:mon` with real Gen 9 moves + category + base power.
- `POST /api/generate-report` → real evaluator (`engine.js`). Uses
  `@smogon/calc` for every damage number. It churns candidate move-set
  (setup + best 3 attackers, or best 4 attackers if no setup move is
  selected) × item × EV spread (0/252 on `explore` stats) × nature ×
  ability × boost stage (0–3) and returns the set that beats the most of
  the opponent draft 1v1, with the per-opponent breakdown and a few
  runner-up sets.
- `gen9_filtered.js` → the opponent set database (`SETDEX_SV` format).
  `setdex.js`'s `threatProfile()` collapses all of a mon's sets into the
  **union** of every move / ability / item they run; the engine builds the
  worst-case spread around that. Mons missing from it fall back to
  representative STAB moves (flagged in the report).
- `names.js` → resolves draft-sheet display names ("Hisuian Samurott",
  "Mega Diancie", "Calyrex-Ice Rider") to canonical Showdown species names.
  Palafin resolves to `Palafin-Hero` (Zero to Hero — Hero forme is the one
  that fights).
- `data/movepoolOverrides.js` → per-species move add/remove, for when your
  league's move-legality differs from Showdown's SV dex (e.g. Latios +
  Mystical Fire, a Gen 8 transfer move Showdown doesn't grant in SV).
- `data/competitiveItems.js` → the ~130-item picker list. `npm run
  refresh-data` re-downloads the Showdown dex caches.

## Evaluation rules
- Level 100. Every calc uses the **max (100%) damage roll**.
- **Opponent model — worst-case counterplay, real spreads only.** Per
  opponent mon the engine takes the union of every damaging move across all
  its known sets, and the *real* spread bundle (ability / item / nature /
  EVs / IVs) from each of those sets, de-duped. It pairs the union move pool
  with each real spread and picks whichever spread is worst for us — it
  never invents a spread. So a Ting-Lu buried in utility sets gets its
  bulkiest real spread + Throat Chop from a coverage set, and a "specially
  defensive" Sandslash also gets checked with its real Swords Dance spread.
  Scarf / Booster Energy only enter if a known set actually runs one. No
  format filtering on the spreads — the absolute-worst-case set counts, and
  the report card names which set it is (so you can see that anything short
  of the bulkiest spread needs fewer boosts). "Worst" = a loss first, then
  most hits-to-KO, then the spread we do *least* to — so a Psyshock user's
  named worst case is the physically-defensive set, not the specially-
  defensive one.
  (Mons absent from `gen9_filtered.js` fall back to a synthesised
  offensive + bulky pair, flagged in the report.)
- **Custom opponent sets.** Step 6 takes a Showdown export paste per mon
  (`parseShowdownSet.js`). It's additive: the pasted set's moves join the
  threat union and its spread joins the variant list. For a mon with no set
  data at all, a paste replaces the STAB guess.
- A matchup is a **win** only if we beat *every* real spread. Per spread the
  engine tries each of our moves and keeps the one with the best outcome for
  us — not just the hardest hit. So a +1 Jet Punch is preferred over a
  stronger non-priority move when we're slower and the stronger move would
  eat a lethal hit first. KO in ≤2 hits, survive at max roll given move
  order (Choice Scarf, speed boost stages, Booster Energy on a speed-topped
  Proto/Quark mon all factored; a speed tie counts as us moving second).
  Boost stages (Calm Mind SpD, Bulk Up Def, …) apply to our survival calc,
  not just our offence.
- **Pivot moves** (U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport,
  Baton Pass, Shed Tail, Chilly Reception) are never candidate attackers —
  using one ends the sweep attempt.
- Wins are graded by **KO quality**, since a sweep can't trade damage every
  turn: `clean` (takes zero damage), `favorable` (one hit, <50% total),
  `risky` (wins the 1v1 but takes a real chunk). The grid colours by this;
  a `+N` badge shows the boosts that KO needed.
- **Roll safety.** Every KO also reports `guaranteed` / `NN% roll` /
  `high roll only`, from the calc's min–max range. Max-roll still decides
  win/loss (per your call), but a high-roll-only win is dashed on the card.
- **Per-stage ladder.** The winning set's matchups carry a `ladder` array
  (stage 0…cap), so the results grid has a `min / +0 / +1 / +2 / +3`
  toggle that recolours and re-notes every card at that fixed boost stage.
- Each card splits the calc into `you →` / `them →` lines and bolds the one
  of your 3 moves doing the work; the best-set panel shows the work split
  (how many matchups each move closes).
- **Set score** (what the search actually maximises): each matchup is worth
  `relevance × value`, summed.
  - `relevance` = the opponent's KDA.csv point cost (fallback 8). Draft
    opponents bring 6 of their pool, so beating a 17-point mon is worth far
    more than beating a 3-point one.
  - `value` = KO-quality weight (`clean 1.0 / favorable 0.88 / risky 0.72`)
    minus a **super-linear boost tax** (`+1 −0.30, +2 −0.62, +3 −1.00`), so
    a set that sweeps at +1 beats one that needs +3 even at equal coverage.
    A loss is `−0.5`.
  - The results grid is ordered heaviest-point-first.
- No chip damage, no hazards, no Tera (opponent "(T)" markers are ignored
  on paste). Choice items and Assault Vest pin the search to 0 boosts.
- Boost stages are **solved for, not entered** — the report says each KO
  needs 0/1/2/3 of whatever boosting move is in the selected pool.
- Mega candidates ("Mega X" in the draft sheet) are already the mega forme
  in the calc, so the item step is skipped and the stone is implied.
- The response carries a `stats` block: candidate sets checked, opponent
  configs tested, unique damage calcs run.

## Learnset resolution
Showdown stores each move on the lowest evolution that learns it and its
validator walks the `prevo` chain — so `getLearnset` merges a mon's whole
pre-evolution line (that's how Samurott-Hisui gets Sacred Sword, off
Oshawott). Megas / cosmetic formes with no learnset of their own fall back
to the base species and its chain. `data/movepoolOverrides.js` is then
applied on top.

Note: Showdown's SV learnset for Latios / Latias does **not** include
Mystical Fire (it's a Gen 8 transfer move) — that's not a stale cache,
the live data agrees. `movepoolOverrides.js` adds it back for leagues that
allow transfer moves. Run `npm run refresh-data` if Showdown itself ships
changes.

## Run it
```
npm install
npm start
```
Then open http://localhost:3000

The first time you select a candidate and it needs to fetch that mon's
movepool, expect a few seconds of delay (downloading ~3MB from Showdown).
Every request after that is instant, pulled from `.cache/`.

## Wizard flow (6 steps)
1. Opponent draft — search, or paste a block copied straight from the draft
   sheet (one mon per line, "(T)" tera marker ignored automatically)
2. Your candidate — search, single-select
3. Move pool — nothing checked by default, searchable, star = lock into
   every generated set. Next stays disabled until at least 4 are picked. If
   a setup move (`BOOST_TABLE`) is among them the set is setup + best 3
   attackers; otherwise it's best 4 attackers.
4. EV assumptions — Explore (0/252 only) / Lock / Skip per stat. No
   fine-grained EV step size anymore — this tool finds the best moves for a
   role, not a fully-optimized spread, so 0/252 keeps the combinatorics sane.
5. Items — searchable, curated to ~130 competitively relevant Gen 9 items
   (`data/competitiveItems.js`), validated against `@smogon/calc`'s names.
   Skipped entirely for Mega candidates.
6. Opponent threats — shows the union of damaging moves the worst-case
   model assumes per opponent (spot a mon whose `gen9_filtered.js` entry is
   missing a threat). Click **×** on a move to drop it from that mon's threat
   union (Hyper Beam / Giga Impact off a 1v1 set, etc.); **＋** restores it.
   Each row also takes a Showdown-export paste to add a custom set.

There's no "boost stage" step, and the search doesn't choose whether to run
a setup move — if a `BOOST_TABLE` move is among your selected moves it is in
**every** generated set (setup + best 3 attackers) and the evaluator solves
for how many stages each KO needs (0–3). To see pure-offense sets instead,
just don't select a setup move (it'll build best-4-attackers). Comparing
"with setup vs without" automatically is a future feature.

Nav buttons are sticky at both the top and bottom of the page, since
step 1's list can be 1000+ cards tall before you start typing in the search.

## Known limitations
- 5 draft-sheet names don't auto-resolve to a species and are handled by
  explicit aliases in `names.js` (two bogus "Mega" entries, the three
  Paldean Tauros breeds). If a new one shows up, add it there.
- Tera is not modelled at all.
- Opponent spreads come straight from `gen9_filtered.js` — no EV
  fine-tuning or speed-creep. The union move pool is decoupled from the
  spread, so a bulky spread can be paired with a coverage move from a
  different (offensive) set even if that move would hit harder off the
  offensive spread's investment. Deliberate over-coverage.
- The model assumes worst-case counterplay, so it's pessimistic by design —
  a mon that "loses" may still be sweepable with chip/hazards the model
  doesn't account for.

Results panel renders a color-coded grid by KO quality:
green (clean) → light green (favorable) → amber (risky) → red (can't win),
with a +N badge per cell for boosts needed. Every cell — wins and losses —
names the move, the damage %, the speed comparison, and the opponent's
best response. For losses on the winning set, the note also says whether a
move cut from that set would have flipped the matchup.

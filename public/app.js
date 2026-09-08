const state = {
  step: 0,
  draftPool: [],
  opponentDraft: [],
  candidate: null,
  movepool: [],
  selectedMoves: new Set(),
  lockedMoves: new Set(),
  evs: { hp:'explore', atk:'explore', def:'explore', spa:'explore', spd:'explore', spe:'lock' },
  evValues: { hp:0, atk:0, def:0, spa:0, spd:0, spe:252 },
  evStep: 252, // fixed: explore stats are tested at 0 or 252 only, no fine-grained EVs
  allItems: [],
  selectedItems: new Set(),
  manualSets: {},       // mon -> Showdown export text (custom opponent sets)
  removedThreats: {},   // mon -> [move names] to drop from the threat union
  lastReport: null,
  viewStage: 'min',     // results grid: 'min' | 0 | 1 | 2 | 3
};

const LAST_WIZARD_STEP = 5; // step index where "Next" becomes "Generate report"

const TYPE_COLORS = {
  Normal:'#9099a1', Fire:'#ff9d55', Water:'#4d90d5', Electric:'#f3d23b',
  Grass:'#63bb5b', Ice:'#73cec0', Fighting:'#ce4069', Poison:'#ab6ac8',
  Ground:'#d97746', Flying:'#8fa8dd', Psychic:'#f97176', Bug:'#90c12c',
  Rock:'#c7b78b', Ghost:'#5269ac', Dragon:'#0a6dc4', Dark:'#5a5366',
  Steel:'#5a8ea1', Fairy:'#ec8fe6',
};

// Status moves worth surfacing in the top ("useful") section — setup,
// recovery, hazards, speed control, disruption. Everything else status-only
// drops to the "situational" section. Damaging moves are always up top.
const USEFUL_STATUS = new Set([
  // setup
  'Swords Dance','Nasty Plot','Dragon Dance','Calm Mind','Quiver Dance','Bulk Up',
  'Coil','Agility','Rock Polish','Shell Smash','Growth','Curse','Victory Dance',
  'Tidy Up','Work Up','Howl','Meditate','Iron Defense','Acid Armor','Autotomize',
  'Hone Claws','Shift Gear','Tail Glow','Belly Drum','No Retreat','Clangorous Soul',
  'Geomancy','Cosmic Power','Bulk Up','Take Heart','Charge','Stockpile','Amnesia',
  'Cotton Guard','Victory Dance',
  // recovery
  'Recover','Roost','Slack Off','Soft-Boiled','Synthesis','Morning Sun','Moonlight',
  'Rest','Wish','Milk Drink','Shore Up','Strength Sap','Life Dew','Jungle Healing',
  'Lunar Blessing','Heal Order','Pain Split','Leech Seed',
  // hazards / removal
  'Stealth Rock','Spikes','Toxic Spikes','Sticky Web','Defog',
  // status / disruption
  'Will-O-Wisp','Thunder Wave','Toxic','Glare','Yawn','Spore','Sleep Powder',
  'Hypnosis','Sing','Lovely Kiss','Grass Whistle','Confuse Ray','Nuzzle',
  'Taunt','Encore','Disable','Haze','Whirlwind','Roar','Parting Shot','Teleport',
  'Chilly Reception','Trick','Switcheroo','Destiny Bond',
  // screens / protection / support
  'Trick Room','Tailwind','Light Screen','Reflect','Aurora Veil','Substitute',
  'Protect','Detect','Baneful Bunker','Spiky Shield','Silk Trap','Heal Bell',
  'Aromatherapy','Healing Wish','Lunar Dance','Memento',
]);

function moveIsUseful(move) {
  return move.bp > 0 || move.cat !== 'Status' || USEFUL_STATUS.has(move.name);
}

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function init() {
  // Wire up everything that doesn't depend on a network call first, so a
  // failed fetch later can't leave the page half-broken (buttons dead,
  // nothing rendered). This was the actual bug last round: the items fetch
  // threw, and because nothing after it in init() had run yet, the opponent
  // list never rendered and Next/Back never got their click handlers.
  wireStaticEventListeners();
  renderRail();
  updateNavButtons();

  try {
    state.draftPool = await getJSON('/api/draft-pool');
  } catch (err) {
    console.error(err);
    showLoadError('oppOptions', "Couldn't load the draft pool. Check the terminal running the server for the real error, and confirm data/KDA.csv is in place.");
    showLoadError('candOptions', "Couldn't load the draft pool.");
    return;
  }
  renderOppOptions();
  renderCandOptions();
}

function showLoadError(containerId, message) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<p class="hint">${message}</p>`;
}

function wireStaticEventListeners() {
  document.getElementById('oppSearch').addEventListener('input', renderOppOptions);
  document.getElementById('candSearch').addEventListener('input', renderCandOptions);
  document.getElementById('itemSearch').addEventListener('input', renderItemOptions);
  document.getElementById('moveSearch').addEventListener('input', renderMoveList);

  document.getElementById('btnPasteAdd').addEventListener('click', handlePasteAdd);

  document.getElementById('btnNext').addEventListener('click', onNext);
  document.getElementById('btnBack').addEventListener('click', onBack);
  document.getElementById('btnNextTop').addEventListener('click', onNext);
  document.getElementById('btnBackTop').addEventListener('click', onBack);
}

// Items are fetched lazily, the first time step 4 is reached — keeps a
// slow/failed Showdown request from blocking anything before it, and keeps
// startup faster since most sessions won't even need it right away.
let itemsLoadAttempted = false;
async function ensureItemsLoaded() {
  if (itemsLoadAttempted) return;
  itemsLoadAttempted = true;
  try {
    state.allItems = await getJSON('/api/items');
  } catch (err) {
    console.error(err);
    showLoadError('itemOptions', "Couldn't load the item list from Showdown. Check the terminal running the server for the real error — this step just won't have data until that's fixed, everything else still works.");
  }
}

// ── Step 0: opponent draft ──────────────────────────────────────────────

function renderOppOptions() {
  const q = document.getElementById('oppSearch').value.toLowerCase();
  const container = document.getElementById('oppOptions');
  container.innerHTML = '';
  state.draftPool
    .filter(name => name.toLowerCase().includes(q))
    .forEach(name => {
      const card = document.createElement('div');
      card.className = 'option-card' + (state.opponentDraft.includes(name) ? ' selected' : '');
      card.innerHTML = `<span class="dot"></span>${name}`;
      card.addEventListener('click', () => {
        if (state.opponentDraft.includes(name)) {
          state.opponentDraft = state.opponentDraft.filter(n => n !== name);
        } else {
          state.opponentDraft.push(name);
        }
        renderOppOptions();
        renderOppChips();
        updateNavButtons();
      });
      container.appendChild(card);
    });
}

function renderOppChips() {
  const row = document.getElementById('oppChips');
  row.innerHTML = '';
  row.hidden = state.opponentDraft.length === 0;
  state.opponentDraft.forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${name} <button type="button" aria-label="remove">&times;</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.opponentDraft = state.opponentDraft.filter(n => n !== name);
      renderOppOptions();
      renderOppChips();
      updateNavButtons();
    });
    row.appendChild(chip);
  });
}

// Bulk-paste from the draft sheet: one name per line, "(T)" tera marker
// (any case, with or without space) stripped and ignored, matched
// case-insensitively against the real draft pool.
function handlePasteAdd() {
  const raw = document.getElementById('oppPaste').value;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  const poolByLower = new Map(state.draftPool.map(name => [name.toLowerCase(), name]));
  const unmatched = [];

  lines.forEach(line => {
    const cleaned = line.replace(/\s*\(t\)\s*$/i, '').trim();
    const match = poolByLower.get(cleaned.toLowerCase());
    if (match) {
      if (!state.opponentDraft.includes(match)) state.opponentDraft.push(match);
    } else {
      unmatched.push(line);
    }
  });

  const warning = document.getElementById('pasteWarning');
  if (unmatched.length) {
    warning.hidden = false;
    warning.textContent = `Couldn't match: ${unmatched.join(', ')} — check spelling against the draft sheet.`;
  } else {
    warning.hidden = true;
  }

  document.getElementById('oppPaste').value = '';
  renderOppOptions();
  renderOppChips();
  updateNavButtons();
}

// ── Step 1: candidate ────────────────────────────────────────────────────

function renderCandOptions() {
  const q = document.getElementById('candSearch').value.toLowerCase();
  const container = document.getElementById('candOptions');
  container.innerHTML = '';
  state.draftPool
    .filter(name => name.toLowerCase().includes(q))
    .forEach(name => {
      const card = document.createElement('div');
      card.className = 'option-card' + (state.candidate === name ? ' selected' : '');
      card.innerHTML = `<span class="dot"></span>${name}`;
      card.addEventListener('click', async () => {
        state.candidate = name;
        // This draft sheet names every Mega as "Mega <base>". A Mega holds
        // its stone and nothing else, so the item step is skipped for them.
        state.candidateIsMega = /^Mega /.test(name);
        if (state.candidateIsMega) { state.selectedItems.clear(); renderItemChips(); }
        renderCandOptions();
        updateNavButtons();
        await loadMovepool(name);
      });
      container.appendChild(card);
    });
}

async function loadMovepool(name) {
  try {
    state.movepool = await getJSON(`/api/movepool/${encodeURIComponent(name)}`);
  } catch {
    state.movepool = [];
  }
  // Nothing pre-checked — with 1000+ mons some have huge movepools, and
  // starting from zero is faster to work with than unchecking a pile.
  state.selectedMoves = new Set();
  state.lockedMoves = new Set();
  renderMoveList();
}

// ── Step 2: move pool ────────────────────────────────────────────────────

function makeMoveRow(move) {
  const row = document.createElement('div');
  row.className = 'move-row';
  const checked = state.selectedMoves.has(move.name);
  const locked = state.lockedMoves.has(move.name);
  const type = move.type || '—';
  const color = TYPE_COLORS[move.type] || 'var(--text-faint)';
  row.innerHTML = `
    <input type="checkbox" ${checked ? 'checked' : ''}>
    <span class="move-name">${move.name}</span>
    <span class="move-type" style="background:${color}">${type}</span>
    <span class="move-cat">${move.cat}</span>
    <span class="move-bp">${move.bp ? move.bp + ' BP' : '—'}</span>
    <button type="button" class="lock-btn ${locked ? 'locked' : ''}" title="Lock into every generated set">★</button>
  `;
  row.querySelector('input').addEventListener('change', e => {
    if (e.target.checked) state.selectedMoves.add(move.name);
    else { state.selectedMoves.delete(move.name); state.lockedMoves.delete(move.name); }
    renderMoveList();
    updateStatHint();
    updateNavButtons();
  });
  row.querySelector('.lock-btn').addEventListener('click', () => {
    if (state.lockedMoves.has(move.name)) {
      state.lockedMoves.delete(move.name);
    } else {
      state.lockedMoves.add(move.name);
      state.selectedMoves.add(move.name); // locking a move implies testing it
    }
    renderMoveList();
    updateStatHint();
    updateNavButtons();
  });
  return row;
}

function renderMoveChips() {
  const row = document.getElementById('moveChips');
  row.innerHTML = '';
  row.hidden = state.selectedMoves.size === 0;
  [...state.selectedMoves].forEach(name => {
    const locked = state.lockedMoves.has(name);
    const chip = document.createElement('span');
    chip.className = 'chip' + (locked ? ' chip-locked' : '');
    chip.innerHTML = `${locked ? '★ ' : ''}${name} <button type="button" aria-label="remove">&times;</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.selectedMoves.delete(name);
      state.lockedMoves.delete(name);
      renderMoveList();
      updateStatHint();
      updateNavButtons();
    });
    row.appendChild(chip);
  });
}

function renderMoveList() {
  renderMoveChips();
  const q = document.getElementById('moveSearch').value.toLowerCase();
  const container = document.getElementById('moveList');
  container.innerHTML = '';
  if (state.movepool.length === 0) {
    container.innerHTML = `<p class="hint">No movepool data yet for ${state.candidate ?? 'this mon'} — pick a candidate in step 2 first.</p>`;
    return;
  }

  const matches = state.movepool.filter(m => m.name.toLowerCase().includes(q));
  const useful = matches.filter(moveIsUseful).sort((a, b) => a.name.localeCompare(b.name));
  const rest = matches.filter(m => !moveIsUseful(m)).sort((a, b) => a.name.localeCompare(b.name));

  const section = (label, list) => {
    if (list.length === 0) return;
    const head = document.createElement('p');
    head.className = 'move-section-head';
    head.textContent = label;
    container.appendChild(head);
    list.forEach(m => container.appendChild(makeMoveRow(m)));
  };
  section('Attacking & utility', useful);
  section('Situational', rest);

  updateStatHint();
}

function updateStatHint() {
  const hint = document.getElementById('statHint');
  const n = state.selectedMoves.size;
  if (n < 4) {
    hint.textContent = `Select at least 4 moves to continue (${n}/4) — the evaluator builds a 4-move set: your setup move + best 3 attackers, or best 4 attackers if you pick none.`;
    return;
  }
  const selected = state.movepool.filter(m => state.selectedMoves.has(m.name));
  const physBP = selected.filter(m => m.cat === 'Physical').reduce((s, m) => s + m.bp, 0);
  const specBP = selected.filter(m => m.cat === 'Special').reduce((s, m) => s + m.bp, 0);
  if (physBP === 0 && specBP === 0) { hint.textContent = `${n} moves selected.`; return; }
  const lean = physBP > specBP ? 'Attack' : specBP > physBP ? 'Sp. Atk' : 'Attack and Sp. Atk equally';
  hint.textContent = `${n} moves selected. Suggested offensive EV focus: ${lean} (physical BP ${physBP} vs special BP ${specBP} — override in the next step)`;
}

// ── Step 3: EVs ──────────────────────────────────────────────────────────

const STAT_LABELS = { hp:'HP', atk:'Attack', def:'Defense', spa:'Sp. Atk', spd:'Sp. Def', spe:'Speed' };

function renderEvGrid() {
  const container = document.getElementById('evGrid');
  container.innerHTML = '';
  Object.keys(STAT_LABELS).forEach(stat => {
    const cell = document.createElement('div');
    cell.className = 'ev-cell';
    const mode = state.evs[stat];
    cell.innerHTML = `
      <span class="ev-cell-label">${STAT_LABELS[stat]}</span>
      <div class="ev-modes">
        <button type="button" data-mode="explore" class="ev-mode-btn ${mode==='explore'?'active':''}">Explore (0/252)</button>
        <button type="button" data-mode="lock" class="ev-mode-btn ${mode==='lock'?'active':''}">Lock</button>
        <button type="button" data-mode="skip" class="ev-mode-btn ${mode==='skip'?'active':''}">Skip</button>
      </div>
      <input type="number" class="ev-value-input" min="0" max="252" step="4"
        value="${state.evValues[stat]}" ${mode==='lock' ? '' : 'disabled'}>
    `;
    cell.querySelectorAll('.ev-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.evs[stat] = btn.dataset.mode;
        renderEvGrid();
      });
    });
    cell.querySelector('.ev-value-input').addEventListener('input', e => {
      state.evValues[stat] = Number(e.target.value);
    });
    container.appendChild(cell);
  });
}

// ── Step 4: items ────────────────────────────────────────────────────────

function renderItemOptions() {
  const q = document.getElementById('itemSearch').value.toLowerCase();
  const container = document.getElementById('itemOptions');
  const search = document.getElementById('itemSearch');
  container.innerHTML = '';

  if (state.candidateIsMega) {
    if (search) search.hidden = true;
    container.innerHTML = `<p class="hint">${state.candidate} holds its Mega Stone — there's no item choice to test. This step is skipped; hit Next.</p>`;
    return;
  }
  if (search) search.hidden = false;

  state.allItems
    .filter(name => name.toLowerCase().includes(q))
    .forEach(name => {
      const card = document.createElement('div');
      card.className = 'option-card' + (state.selectedItems.has(name) ? ' selected' : '');
      card.innerHTML = `<span class="dot"></span>${name}`;
      card.addEventListener('click', () => {
        if (state.selectedItems.has(name)) state.selectedItems.delete(name);
        else state.selectedItems.add(name);
        renderItemOptions();
        renderItemChips();
        updateNavButtons();
      });
      container.appendChild(card);
    });
}

function renderItemChips() {
  const row = document.getElementById('itemChips');
  row.innerHTML = '';
  [...state.selectedItems].forEach(name => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${name} <button type="button" aria-label="remove">&times;</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      state.selectedItems.delete(name);
      renderItemOptions();
      renderItemChips();
      updateNavButtons();
    });
    row.appendChild(chip);
  });
}

// ── Step 5: opponent threats ─────────────────────────────────────────────
// Shows the union of damaging moves the worst-case model will assume per
// opponent (from all known sets). Click × on a move to drop it (e.g. Hyper
// Beam / Giga Impact off a 1v1 set that isn't a real threat). Each row also
// takes a paste box for a custom Showdown set — additive: its moves join the
// threat union and its spread joins the variant list.

async function renderOppThreats() {
  const container = document.getElementById('oppSetList');
  container.innerHTML = '<p class="hint">Loading threat pools…</p>';
  const rows = await Promise.all(state.opponentDraft.map(async name => {
    let data;
    try { data = await getJSON(`/api/threats/${encodeURIComponent(name)}`); }
    catch { data = { known: false, damaging: [], abilities: [] }; }
    return { name, ...data };
  }));
  container.innerHTML = '';
  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'opp-threat-row';
    const removed = new Set(state.removedThreats[r.name] || []);
    const moves = r.damaging.length
      ? r.damaging.map(m =>
          `<span class="threat-move${removed.has(m) ? ' removed' : ''}" data-move="${m}">${m}` +
          `<button type="button" aria-label="toggle">${removed.has(m) ? '＋' : '×'}</button></span>`
        ).join('')
      : `<span class="hint">${r.known ? 'no damaging moves on any set' : 'not in the sets file — STAB moves assumed'}</span>`;
    const custom = state.manualSets[r.name] || '';
    const setCount = (custom.match(/^-\s/gm) || []).length ? (custom.split(/\n\s*\n/).filter(b => b.trim()).length) : 0;
    row.innerHTML = `
      <div class="opp-threat-name">${r.name}${setCount ? ` <span class="threat-custom-tag">+${setCount} custom</span>` : ''}</div>
      <div class="threat-moves">${moves}</div>
      <details class="threat-custom" ${custom ? 'open' : ''}>
        <summary>add a custom set (Showdown paste)</summary>
        <textarea class="threat-custom-input" rows="7" placeholder="Ting-Lu @ Assault Vest&#10;Ability: Vessel of Ruin&#10;EVs: 4 HP / 252 Atk / 252 Spe&#10;Jolly Nature&#10;- Throat Chop&#10;- Earthquake&#10;- Stone Edge&#10;- Heavy Slam">${custom}</textarea>
      </details>
    `;
    row.querySelectorAll('.threat-move button').forEach(btn => {
      btn.addEventListener('click', () => {
        const chip = btn.closest('.threat-move');
        const mv = chip.dataset.move;
        const list = state.removedThreats[r.name] || (state.removedThreats[r.name] = []);
        const i = list.indexOf(mv);
        if (i === -1) { list.push(mv); chip.classList.add('removed'); btn.textContent = '＋'; }
        else { list.splice(i, 1); chip.classList.remove('removed'); btn.textContent = '×'; }
        if (list.length === 0) delete state.removedThreats[r.name];
      });
    });

    const ta = row.querySelector('.threat-custom-input');
    ta.addEventListener('input', () => {
      if (ta.value.trim()) state.manualSets[r.name] = ta.value;
      else delete state.manualSets[r.name];
      const tag = row.querySelector('.threat-custom-tag');
      const n = ta.value.split(/\n\s*\n/).filter(b => /^-\s/m.test(b)).length;
      if (tag) tag.textContent = n ? `+${n} custom` : '';
      else if (n) row.querySelector('.opp-threat-name').insertAdjacentHTML('beforeend', ` <span class="threat-custom-tag">+${n} custom</span>`);
    });
    container.appendChild(row);
  });
}

// ── Results ──────────────────────────────────────────────────────────────

// Cell colour is KO quality (clean/favorable/risky), not boost count.
const QUALITY_CLASS = { clean: 'q-clean', favorable: 'q-favorable', risky: 'q-risky' };

function evString(evs) {
  const order = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const label = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
  const parts = order.filter(k => evs[k]).map(k => `${evs[k]} ${label[k]}`);
  return parts.length ? parts.join(' / ') : 'no EVs';
}

function setLine(s, megaStone) {
  const moves = s.boostMove ? [s.boostMove, ...s.moves] : s.moves;
  const item = s.item || megaStone || 'no item';
  return `${[item, s.ability, s.nature, evString(s.evs)].join(' · ')} — ${moves.join(' / ')}`;
}

async function generateReport() {
  const grid = document.getElementById('resultsGrid');
  const bestBox = document.getElementById('bestSet');
  const altBox = document.getElementById('alternatives');
  grid.innerHTML = `<p class="hint">Churning move / item / EV / boost combinations through the calc…</p>`;
  bestBox.innerHTML = '';
  altBox.innerHTML = '';
  document.getElementById('resultsTitle').textContent = `${state.candidate} — win-con breakdown`;

  let data;
  try {
    data = await getJSON('/api/generate-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        opponentDraft: state.opponentDraft,
        candidate: state.candidate,
        selectedMoves: [...state.selectedMoves],
        lockedMoves: [...state.lockedMoves],
        evs: state.evs,
        evValues: state.evValues,
        selectedItems: [...state.selectedItems],
        manualSets: state.manualSets,
        removedThreats: state.removedThreats,
      }),
    });
  } catch (err) {
    grid.innerHTML = `<p class="hint">Report failed: ${err.message}. Check the server terminal.</p>`;
    return;
  }

  state.lastReport = data;
  state.viewStage = 'min';
  renderResults();
}

// pick the ladder rung to display for a matchup given the current toggle
function rungForView(r) {
  if (state.viewStage === 'min' || !r.ladder || !r.ladder.length) return null;
  const idx = Math.min(state.viewStage, r.ladder.length - 1);
  return r.ladder[idx];
}

function renderResults() {
  const data = state.lastReport;
  if (!data) return;
  const b = data.best;
  const stone = data.megaStone;
  const s = data.stats || {};
  document.getElementById('resultsTitle').textContent = `${data.candidate} — beats ${b.beats}/${b.total} 1v1`;

  // ── best-set panel: set line, dropped moves, per-move work tally ──
  const tally = {};
  b.perOpponent.forEach(r => { if (r.result === 'win' && r.workMove) tally[r.workMove] = (tally[r.workMove] || 0) + 1; });
  const tallyStr = b.moves.map(m => `${m} ${tally[m] || 0}`).join(' · ');
  const q = { clean: 0, favorable: 0, risky: 0 };
  b.perOpponent.forEach(r => { if (r.result === 'win') q[r.quality]++; });
  const qualBits = [];
  if (q.clean) qualBits.push(`${q.clean} clean`);
  if (q.favorable) qualBits.push(`${q.favorable} favorable`);
  if (q.risky) qualBits.push(`${q.risky} risky`);
  const dropped = b.droppedMoves.length ? `<p class="best-drop">Drop this week: <strong>${b.droppedMoves.join(', ')}</strong></p>` : '';
  document.getElementById('bestSet').innerHTML = `
    <p class="best-label">Best set found · score ${b.score}</p>
    <p class="best-line">${setLine(b, stone)}</p>
    ${dropped}
    <p class="best-meta">work split (matchups each move closes): ${tallyStr}</p>
    <p class="best-meta">${qualBits.join(' · ') || 'no winning matchups'}${b.maxBoostsUsed > 0 ? ` · hardest KO needs ${b.maxBoostsUsed}x ${b.boostMove}` : ''}</p>
    <p class="best-meta">Checked ${fmtNum(s.setsChecked)} candidate sets against ${fmtNum(s.matchupsTested)} opponent configs (${fmtNum(s.damageCalcs)} damage calcs)${data.truncated ? ' · search capped — strong sample, not exhaustive' : ''}</p>
  `;

  // ── summary bar ──
  let raw = 0, setup = 0, loss = 0;
  b.perOpponent.forEach(r => {
    if (r.result !== 'win') loss++;
    else if (r.boostsNeeded === 0) raw++;
    else setup++;
  });
  document.getElementById('resultsSummary').innerHTML =
    `<span class="sum-win">${raw} raw</span> · <span class="sum-setup">${setup} after setup</span> · <span class="sum-loss">${loss} can't</span>`;

  // ── stage toggle (min / +0..+cap) ──
  const cap = data.boostCap || 0;
  const stages = data.boostMove && cap > 0 ? ['min', 0, 1, 2, 3].filter(x => x === 'min' || x <= cap) : [];
  const toggle = document.getElementById('stageToggle');
  toggle.innerHTML = '';
  toggle.hidden = stages.length === 0;
  stages.forEach(st => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stage-btn' + (state.viewStage === st ? ' active' : '');
    btn.textContent = st === 'min' ? 'min needed' : `+${st}`;
    btn.addEventListener('click', () => { state.viewStage = st; renderResults(); });
    toggle.appendChild(btn);
  });

  // ── grid ──
  const grid = document.getElementById('resultsGrid');
  grid.innerHTML = '';
  b.perOpponent.forEach(r => {
    const rung = rungForView(r);
    const shownWin = rung ? rung.won : r.result === 'win';
    const shownQuality = rung ? rung.quality : r.quality;
    const cls = shownWin ? (QUALITY_CLASS[shownQuality] || 'q-risky') : 'q-loss';
    const stageNum = rung ? rung.stage : r.boostsNeeded;
    const you = rung ? rung.you : r.you;
    const them = rung ? rung.them : r.them;
    const roll = rung ? rung.roll : r.roll;
    const order = rung ? rung.order : r.order;
    const threat = rung ? rung.threat : r.threat;
    const threatSpread = rung ? rung.threatSpread : r.threatSpread;
    const workMove = rung ? rung.workMove : r.workMove;

    const shaky = shownWin && roll && /high roll only/.test(roll);
    const cell = document.createElement('div');
    cell.className = `result-cell ${cls}${shaky ? ' r-shaky' : ''}`;
    const badge = shownWin && stageNum != null
      ? `<span class="r-boost" title="${stageNum === 0 ? 'no setup' : stageNum + ' boost(s)'}">+${stageNum}</span>`
      : (!shownWin ? `<span class="r-boost r-boost-x">✗</span>` : '');
    const pts = r.points != null ? `<span class="r-pts" title="draft point cost">${r.points}pt</span>` : '';
    const head = shownWin ? (shownQuality || 'win') : 'no win';
    const boldYou = you && workMove ? you.replace(workMove, `<strong>${workMove}</strong>`) : you;
    const saver = !shownWin && r.note && /would.*beat|cut from this set/i.test(r.note)
      ? `<div class="r-saver">${r.note.split('—').slice(-1)[0].trim()}</div>` : '';

    cell.innerHTML = `
      ${badge}
      <div class="r-name">${pts}${r.opponent}</div>
      <div class="r-head">${head}</div>
      ${you ? `<div class="r-line"><span class="r-tag">you</span> ${boldYou}${roll ? ` <span class="r-roll">${roll}</span>` : ''}</div>` : ''}
      ${them ? `<div class="r-line"><span class="r-tag">them</span> ${them}</div>` : ''}
      ${order ? `<div class="r-order">${order}</div>` : ''}
      ${threat ? `<div class="r-set">vs ${threat}${threatSpread ? ` — ${threatSpread}` : ''}</div>` : ''}
      ${saver}
    `;
    grid.appendChild(cell);
  });

  // ── alternatives ──
  const altBox = document.getElementById('alternatives');
  if (data.alternatives && data.alternatives.length) {
    altBox.innerHTML = `<p class="alt-label">Runner-up sets</p>` + data.alternatives
      .map(a => `<p class="alt-line"><span class="alt-score">${a.beats}/${a.total}</span> ${setLine(a, stone)}</p>`)
      .join('');
  } else {
    altBox.innerHTML = '';
  }
}

function fmtNum(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '—';
}

// ── Wizard nav / rail ─────────────────────────────────────────────────────

function renderRail() {
  document.querySelectorAll('#railSteps li').forEach(li => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === state.step);
    li.classList.toggle('done', s < state.step);
  });
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.dataset.panel !== String(name));
}

function stepIsValid() {
  switch (state.step) {
    case 0: return state.opponentDraft.length > 0;
    case 1: return !!state.candidate;
    case 2: return state.selectedMoves.size >= 4;
    case 4: return state.candidateIsMega || state.selectedItems.size > 0;
    default: return true;
  }
}

function updateNavButtons() {
  const valid = stepIsValid();
  const label = state.step === LAST_WIZARD_STEP ? 'Generate report' : 'Next';
  [document.getElementById('btnNext'), document.getElementById('btnNextTop')].forEach(btn => {
    btn.disabled = !valid;
    btn.textContent = label;
  });
  const backVisibility = state.step === 0 ? 'hidden' : 'visible';
  document.getElementById('btnBack').style.visibility = backVisibility;
  document.getElementById('btnBackTop').style.visibility = backVisibility;
}

async function onNext() {
  if (!stepIsValid()) return;

  if (state.step === LAST_WIZARD_STEP) {
    showPanel('results');
    document.querySelectorAll('.wizard-nav').forEach(el => el.style.display = 'none');
    await generateReport();
    return;
  }

  state.step += 1;
  showPanel(state.step);
  renderRail();
  updateNavButtons();
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (state.step === 3) renderEvGrid();
  if (state.step === 4) { await ensureItemsLoaded(); renderItemOptions(); }
  if (state.step === 5) renderOppThreats();
}

function onBack() {
  if (state.step === 0) return;
  state.step -= 1;
  showPanel(state.step);
  renderRail();
  updateNavButtons();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

showPanel(0);
init();
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { getDraftPoolNames } from './draftPool.js';
import { getLearnset, getAllItemNames } from './pokemonData.js';
import { evaluate } from './engine.js';
import { threatProfile } from './setdex.js';
import pkg from '@smogon/calc';

const { Generations, Move } = pkg;
const GEN9 = Generations.get(9);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── ROUTES ───────────────────────────────────────────────────────────────

app.get('/api/draft-pool', (req, res) => {
  try {
    res.json(getDraftPoolNames());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not read data/KDA.csv — is it in place?' });
  }
});

app.get('/api/movepool/:mon', async (req, res) => {
  try {
    const moves = await getLearnset(req.params.mon);
    if (moves.length === 0) return res.status(404).json({ error: 'no learnset found for that mon' });
    res.json(moves);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to fetch learnset data from Showdown' });
  }
});

app.get('/api/items', async (req, res) => {
  try {
    res.json(await getAllItemNames());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to fetch item data from Showdown' });
  }
});

// The moves the threat model will hold against a candidate for this mon:
// every damaging move across all its known sets (utility moves dropped).
app.get('/api/threats/:mon', async (req, res) => {
  try {
    const prof = await threatProfile(req.params.mon);
    const damaging = prof.moves.filter(m => {
      try { return new Move(GEN9, m).category !== 'Status'; } catch { return false; }
    }).sort((a, b) => a.localeCompare(b));
    res.json({ known: prof.known, damaging, abilities: prof.abilities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to build threat profile' });
  }
});

// Real evaluator: churns candidate move/item/EV/nature/ability/boost-stage
// combinations through @smogon/calc and returns the set that sweeps the most
// of the opponent draft, with the per-opponent breakdown. Boost stages are
// solved for, not supplied — the response says how many each KO needs.
app.post('/api/generate-report', async (req, res) => {
  try {
    const report = await evaluate(req.body || {});
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'evaluation failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Draft Buildbot running at http://localhost:${PORT}`));

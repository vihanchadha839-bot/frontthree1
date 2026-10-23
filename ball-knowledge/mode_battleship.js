// Football Battleship: grid of clubs x nations. To fire at a square you must name a real player who fits both.
const D = require('./data');
const { BIG_CLUBS } = require('./questions');

const TURN_MS = 40000;
const N = 5;
const SHIPS = [3, 2, 2, 1];
const NATION_POOL = ['England', 'Spain', 'France', 'Brazil', 'Argentina', 'Germany', 'Italy', 'Netherlands', 'Portugal', 'Belgium', 'Uruguay', 'Croatia', 'Denmark', 'Scotland', 'Senegal', 'Nigeria', 'Cote d\'Ivoire', 'Colombia', 'Morocco', 'United States', 'Mexico', 'Ireland', 'Wales', 'Serbia', 'Switzerland', 'Sweden', 'Norway', 'Ghana', 'Cameroon', 'Japan'];

const INDEX = new Map();
for (const p of D.PLAYERS) for (const c of p.clubs) {
  const k = c.id + '|' + p.nation;
  if (!INDEX.has(k)) INDEX.set(k, []);
  if (!INDEX.get(k).includes(p)) INDEX.get(k).push(p);
}
function cellPlayers(clubId, nation) { return INDEX.get(clubId + '|' + nation) || []; }

function buildGrid(tier, minCount) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const nations = D.sample(attempt < 200 ? NATION_POOL.slice(0, 12) : NATION_POOL, N);
    const clubs = [];
    for (const cid of D.shuffle(BIG_CLUBS)) {
      const ok = nations.every(n => cellPlayers(cid, n).filter(p => p.tier <= tier).length >= minCount);
      if (ok) clubs.push(cid);
      if (clubs.length === N) break;
    }
    if (clubs.length === N) return { clubs, nations };
  }
  throw new Error('Could not build a fair grid');
}

function placeShips() {
  const board = Array.from({ length: N }, () => Array(N).fill(-1));
  SHIPS.forEach((len, si) => {
    for (let t = 0; t < 500; t++) {
      const horiz = Math.random() < 0.5;
      const r = D.rand(horiz ? N : N - len + 1), c = D.rand(horiz ? N - len + 1 : N);
      const cells = Array.from({ length: len }, (_, i) => horiz ? [r, c + i] : [r + i, c]);
      if (cells.every(([a, b]) => board[a][b] === -1)) { cells.forEach(([a, b]) => board[a][b] = si); return; }
    }
  });
  return board;
}

function nextTurn(g, api) {
  g.turns = (g.turns || 0) + 1;
  if (g.turns > 1 && checkEnd(g, api)) return;
  g.turnIdx = (g.turnIdx + 1) % g.ids.length;
  g.deadline = api.timer('t', TURN_MS, () => { g.log.unshift({ pid: g.ids[g.turnIdx], text: 'ran out of time' }); nextTurn(g, api); });
}

function checkEnd(g, api) {
  const allSunk = SHIPS.every((len, si) => g.hits.filter(h => h.ship === si).length === len);
  const openCells = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!g.shots.some(s => s.r === r && s.c === c)) openCells.push([r, c]);
  const playable = openCells.some(([r, c]) => cellPlayers(g.grid.clubs[r], g.grid.nations[c]).some(p => !g.used.includes(p.id)));
  const full = !playable || g.turns >= 80;
  if (allSunk || full) {
    g.phase = 'over'; g.deadline = null; api.clear('t');
    // reveal example answers for every square
    g.answers = g.grid.clubs.map(cid => g.grid.nations.map(n => cellPlayers(cid, n).sort((a, b) => b.fame - a.fame).slice(0, 3).map(p => p.name)));
    api.finish(g.scores);
    return true;
  }
  return false;
}

module.exports = {
  id: 'battleship', name: 'Football Battleship', emoji: '🚢', min: 1, max: 10,
  blurb: 'A hidden fleet sits on a grid of clubs and nations. Fire at a square by naming a player who played for that club and is from that nation.',
  settings: [
    { key: 'tier', label: 'Grid', options: [[1, 'Easy'], [2, 'Medium'], [3, 'Hard'], [4, 'Ridiculous']], default: 2 },
  ],
  create(ids, s, api) {
    const grid = buildGrid(s.tier, s.tier >= 3 ? 1 : 2);
    const g = { ids: D.shuffle(ids), grid, board: placeShips(), shots: [], hits: [], used: [], log: [], scores: {}, turnIdx: -1, phase: 'play', counts: null };
    g.counts = grid.clubs.map(cid => grid.nations.map(n => cellPlayers(cid, n).length));
    ids.forEach(i => g.scores[i] = 0);
    nextTurn(g, api);
    return g;
  },
  action(g, pid, m, api) {
    if (g.phase !== 'play' || m.type !== 'fire' || g.ids[g.turnIdx] !== pid) return;
    const r = Number(m.r), c = Number(m.c);
    if (!(r >= 0 && r < N && c >= 0 && c < N) || g.shots.some(s => s.r === r && s.c === c)) return;
    const cid = g.grid.clubs[r], nation = g.grid.nations[c];
    const cands = cellPlayers(cid, nation).filter(p => !g.used.includes(p.id));
    const match = D.findPlayers(m.text || '', cands)[0];
    const clubName = D.CLUBS[cid].name;
    if (!match) {
      const usedMatch = D.findPlayers(m.text || '', cellPlayers(cid, nation))[0];
      g.log.unshift({ pid, text: `said "${String(m.text).slice(0, 30)}" for ${clubName} × ${nation}. ${usedMatch ? 'Already used!' : 'Wrong!'} No shot.` });
      g.lastShot = { r, c, invalid: true, pid };
      nextTurn(g, api);
      return;
    }
    g.used.push(match.id);
    const ship = g.board[r][c];
    const shot = { r, c, pid, player: match.name, hit: ship >= 0 };
    g.shots.push(shot);
    g.lastShot = shot;
    if (ship >= 0) {
      g.hits.push({ r, c, ship });
      g.scores[pid] += 1;
      const sunk = g.hits.filter(h => h.ship === ship).length === SHIPS[ship];
      if (sunk) { g.scores[pid] += 2; shot.sunk = SHIPS[ship]; }
      g.log.unshift({ pid, text: `${match.name} → ${sunk ? `SUNK a ${SHIPS[ship]}-ship! (+3)` : 'HIT! (+1)'}` });
    } else g.log.unshift({ pid, text: `${match.name} → miss` });
    if (!checkEnd(g, api)) nextTurn(g, api);
  },
  leave(g, pid, api) { if (g.phase === 'play' && g.ids[g.turnIdx] === pid) nextTurn(g, api); },
  view(g, pid) {
    const N_ = N;
    const cells = Array.from({ length: N_ }, (_, r) => Array.from({ length: N_ }, (_, c) => {
      const s = g.shots.find(s => s.r === r && s.c === c);
      const ship = g.board[r][c];
      const sunk = ship >= 0 && g.hits.filter(h => h.ship === ship).length === SHIPS[ship];
      return { shot: !!s, hit: s?.hit || false, sunk, player: s?.player || null, by: s?.pid || null, ship: g.phase === 'over' ? ship : (s?.hit ? ship : null), count: g.counts[r][c] };
    }));
    return {
      type: 'battleship', phase: g.phase, deadline: g.deadline, turnId: g.ids[g.turnIdx], order: g.ids,
      clubs: g.grid.clubs.map(id => D.CLUBS[id].name), nations: g.grid.nations, cells, ships: SHIPS,
      sunkShips: SHIPS.map((len, si) => g.hits.filter(h => h.ship === si).length === len),
      log: g.log.slice(0, 12), lastShot: g.lastShot || null, scores: g.scores, answers: g.answers || null, final: g.final, over: g.over,
    };
  },
};

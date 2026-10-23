// Multiple choice question generator. Every answer is computed from the database, so it is always checkable.
const D = require('./data');
const { PLAYERS, CLUBS, TRANSFERS, pick, shuffle, sample, fmtM, rand, LEAGUE_NAMES, seasonLabel } = D;

// clubs that lots of players have passed through (good distractors / grid rows)
const clubCount = new Map();
for (const p of PLAYERS) for (const c of p.clubs) if (c.apps >= 5) clubCount.set(c.id, (clubCount.get(c.id) || 0) + 1);
const BIG_CLUBS = [...clubCount.entries()].filter(([id, n]) => n >= 60 && CLUBS[id]?.league).map(([id]) => Number(id));
const NATIONS = (() => { const m = {}; PLAYERS.forEach(p => { if (p.nation) m[p.nation] = (m[p.nation] || 0) + 1; }); return Object.entries(m).filter(([, n]) => n >= 25).map(([k]) => k); })();

const tierPool = {};
function poolFor(d, extra) {
  const maxTier = Math.min(4, Math.max(1, d));
  const key = maxTier;
  if (!tierPool[key]) tierPool[key] = PLAYERS.filter(p => p.tier <= maxTier);
  let base = tierPool[key];
  // harder levels should mostly feature less famous players
  if (d >= 3 && Math.random() < 0.7) base = base.filter(p => p.tier >= d - 1);
  return extra ? base.filter(extra) : base;
}
const realClubs = p => p.clubs.filter(c => c.apps >= 8);
const label = p => p.name;
const MC = (cat, q, correct, wrong, fact, extra = {}) => {
  const opts = shuffle([correct, ...wrong]);
  return { cat, q, options: opts, answer: opts.indexOf(correct), fact, ...extra };
};
const era = p => Number(p.dob.slice(0, 4));
const similar = (p, q) => Math.abs(era(p) - era(q)) <= 8 && q.id !== p.id;

const G = {
  careerPath(d) {
    const p = pick(poolFor(d, p => realClubs(p).length >= 3));
    const path = realClubs(p).slice(0, 5);
    const ids = new Set(path.map(c => c.id));
    const wrong = sample(poolFor(Math.max(d, 2), q => similar(p, q) && q.group === p.group && ![...ids].every(i => q._clubIds.has(i))), 3);
    if (wrong.length < 3) return null;
    return MC('Career Paths', `Whose career path is this? ${path.map(c => c.name).join(' → ')}`, label(p), wrong.map(label),
      `${p.name}: ${p.clubs.map(c => c.name).join(', ')}`, { pid: p.id });
  },
  playedFor(d) {
    const p = pick(poolFor(d, p => realClubs(p).length >= 1));
    const right = pick(realClubs(p));
    const leagues = new Set(p.clubs.map(c => CLUBS[c.id]?.league).filter(Boolean));
    const wrong = sample(BIG_CLUBS.filter(id => !p._clubIds.has(id) && leagues.has(CLUBS[id].league)), 3).map(id => CLUBS[id].name);
    if (wrong.length < 3 || wrong.includes(right.name)) return null;
    return MC('Ever Played For?', `Which of these clubs has ${p.name} played for?`, right.name, wrong,
      `${p.name} made ${right.apps} apps for ${right.name} (${right.from}${right.to !== right.from ? '–' + right.to : ''}).`, { pid: p.id });
  },
  oddOneOut(d) {
    const p = pick(poolFor(d, p => realClubs(p).length >= 3));
    const played = sample(realClubs(p), 3).map(c => c.name);
    const leagues = new Set(p.clubs.map(c => CLUBS[c.id]?.league).filter(Boolean));
    const not = sample(BIG_CLUBS.filter(id => !p._clubIds.has(id) && leagues.has(CLUBS[id].league)), 1).map(id => CLUBS[id].name)[0];
    if (!not || played.includes(not)) return null;
    return MC('Ever Played For?', `Which club has ${p.name} NEVER played for?`, not, played,
      `${p.name}'s clubs: ${p.clubs.map(c => c.name).join(', ')}`, { pid: p.id });
  },
  nation(d) {
    const p = pick(poolFor(d, p => p.nation && p.caps > 0));
    const wrong = sample(NATIONS.filter(n => !p.cits.includes(n) && n !== p.nation), 3);
    return MC('Flags & Birthplaces', `Which country has ${p.name} played international football for?`, p.nation, wrong,
      `${p.name}: ${p.caps} caps, ${p.intGoals} goals for ${p.nation}.`, { pid: p.id });
  },
  bornIn(d) {
    const p = pick(poolFor(d, p => p.birthplace && p.birthplace.length > 2));
    const wrong = sample(poolFor(Math.max(d, 2), q => q.birthplace && q.birthplace !== p.birthplace && q.id !== p.id), 3);
    if (wrong.length < 3) return null;
    return MC('Flags & Birthplaces', `Which of these players was born in ${p.birthplace}?`, label(p), wrong.map(label),
      `${p.name} was born in ${p.birthplace}. ${wrong.map(w => `${w.name}: ${w.birthplace}`).join(', ')}.`, { pid: p.id });
  },
  bigFee(d) {
    const minFee = d === 1 ? 40e6 : d === 2 ? 15e6 : 3e6;
    const cands = TRANSFERS.filter(t => t.fee >= minFee && D.BY_ID.get(t.pid).tier <= Math.max(d, 2));
    const t = pick(cands); if (!t) return null;
    const p = D.BY_ID.get(t.pid);
    const wrong = sample(PLAYERS.filter(q => q.tier <= Math.max(d, 2) && similar(p, q) && q.group === p.group && !q._clubIds.has(t.to)), 3);
    if (wrong.length < 3) return null;
    return MC('Big Money', `${t.toName} signed this player from ${t.fromName} for ${fmtM(t.fee)} in ${t.date.slice(0, 4)}. Who?`, label(p), wrong.map(label),
      `${p.name}: ${t.fromName} → ${t.toName}, ${fmtM(t.fee)} (${t.date}).`, { pid: p.id });
  },
  feeGuess(d) {
    const minFee = d === 1 ? 50e6 : d === 2 ? 20e6 : 5e6;
    const t = pick(TRANSFERS.filter(t => t.fee >= minFee && D.BY_ID.get(t.pid).tier <= Math.max(d, 2))); if (!t) return null;
    const p = D.BY_ID.get(t.pid);
    const round = v => v >= 20e6 ? Math.round(v / 5e6) * 5e6 : Math.round(v / 1e6) * 1e6;
    const f = [0.45, 0.65, 1.5, 2.1].map(m => round(t.fee * m));
    const wrongs = shuffle(f).filter(v => Math.abs(v - t.fee) / t.fee > 0.2).slice(0, 3);
    const all = new Set([fmtM(t.fee), ...wrongs.map(fmtM)]);
    if (all.size < 4) return null;
    return MC('Big Money', `How much did ${t.toName} pay ${t.fromName} for ${p.name} in ${t.date.slice(0, 4)}?`, fmtM(t.fee), wrongs.map(fmtM),
      `Transfermarkt fee: ${fmtM(t.fee)}.`, { pid: p.id });
  },
  peakValue(d) {
    const opts = sample(poolFor(d, p => p.peak >= 5e6), 4).sort((a, b) => b.peak - a.peak);
    if (opts.length < 4 || opts[0].peak < opts[1].peak * 1.15) return null;
    return MC('Big Money', 'Who had the highest PEAK market value?', label(opts[0]), opts.slice(1).map(label),
      opts.map(p => `${p.name} ${fmtM(p.peak)}`).join(', '), { pid: opts[0].id });
  },
  moreGoals(d) {
    const ps = sample(poolFor(d, p => p.group !== 'Goalkeeper' && p.goals >= 20), 2).sort((a, b) => b.goals - a.goals);
    if (ps.length < 2 || ps[0].goals < ps[1].goals * 1.15 || ps[0].goals - ps[1].goals < 10) return null;
    return MC('Goal Machines', 'Who has scored more senior club goals in their career?', label(ps[0]), [label(ps[1])],
      `${ps[0].name}: ${ps[0].goals} in ${ps[0].apps}. ${ps[1].name}: ${ps[1].goals} in ${ps[1].apps}.`, { pid: ps[0].id });
  },
  leagueGoals(d) {
    const L = pick(['GB1', 'ES1', 'IT1', 'L1', 'FR1']);
    const ps = sample(poolFor(d, p => p.leagues[L] && p.leagues[L][1] >= 10), 2).sort((a, b) => b.leagues[L][1] - a.leagues[L][1]);
    if (ps.length < 2 || ps[0].leagues[L][1] - ps[1].leagues[L][1] < 8) return null;
    const n = LEAGUE_NAMES[L];
    return MC('Goal Machines', `Who has more ${n} goals?`, label(ps[0]), [label(ps[1])],
      `${ps[0].name}: ${ps[0].leagues[L][1]} ${n} goals. ${ps[1].name}: ${ps[1].leagues[L][1]}.`, { pid: ps[0].id });
  },
  clGoals(d) {
    const ps = sample(poolFor(d, p => p.cl[1] >= 3), 2).sort((a, b) => b.cl[1] - a.cl[1]);
    if (ps.length < 2 || ps[0].cl[1] - ps[1].cl[1] < 4) return null;
    return MC('Goal Machines', 'Who has more Champions League goals?', label(ps[0]), [label(ps[1])],
      `${ps[0].name}: ${ps[0].cl[1]} UCL goals. ${ps[1].name}: ${ps[1].cl[1]}.`, { pid: ps[0].id });
  },
  bestSeason(d) {
    const p = pick(poolFor(d, p => p.best && p.best.goals >= 8));
    const g = p.best.goals;
    const wrong = shuffle([g - 6, g - 3, g + 3, g + 5, g + 8].filter(x => x > 0)).slice(0, 3);
    return MC('Goal Machines', `In ${p.best.season}, how many ${LEAGUE_NAMES[p.best.league]} goals did ${p.name} score for ${p.best.club}?`, String(g), wrong.map(String),
      `${p.name}: ${g} goals and ${p.best.assists} assists in ${p.best.apps} games (${p.best.season}).`, { pid: p.id });
  },
  capsCount(d) {
    const p = pick(poolFor(d, p => p.caps >= 20));
    const c = p.caps;
    const w = shuffle([Math.round(c * 0.55), Math.round(c * 0.75), Math.round(c * 1.3), Math.round(c * 1.6)]).filter(x => Math.abs(x - c) >= 5).slice(0, 3);
    if (w.length < 3 || new Set([c, ...w]).size < 4) return null;
    return MC('Know Your Players', `How many caps had ${p.name} won for ${p.nation} by Sept 2025?`, String(c), w.map(String),
      `${p.name}: ${c} caps, ${p.intGoals} goals.`, { pid: p.id });
  },
  oldest(d) {
    const ps = sample(poolFor(d, p => p.status === 'active'), 4).sort((a, b) => a.dob.localeCompare(b.dob));
    if (ps.length < 4) return null;
    for (let i = 1; i < 4; i++) if (new Date(ps[i].dob) - new Date(ps[i - 1].dob) < 3.15e10) return null; // 1 year apart
    return MC('Know Your Players', 'Who is the OLDEST?', label(ps[0]), ps.slice(1).map(label),
      ps.map(p => `${p.name} (${p.dob.slice(0, 4)})`).join(', '), { pid: ps[0].id });
  },
  tallest(d) {
    const ps = sample(poolFor(d, p => p.height), 4).sort((a, b) => b.height - a.height);
    if (ps.length < 4 || ps[0].height - ps[1].height < 3) return null;
    return MC('Know Your Players', 'Who is the TALLEST?', label(ps[0]), ps.slice(1).map(label),
      ps.map(p => `${p.name} ${p.height}cm`).join(', '), { pid: ps[0].id });
  },
  leftFoot(d) {
    const l = pick(poolFor(d, p => p.foot === 'left' && p.group !== 'Goalkeeper'));
    const r = sample(poolFor(d, p => p.foot === 'right' && p.group === l.group), 3);
    if (r.length < 3) return null;
    return MC('Know Your Players', 'Which of these players is LEFT-footed?', label(l), r.map(label), `${l.name} is left-footed, the others are right-footed.`, { pid: l.id });
  },
  currentClub(d) {
    const p = pick(poolFor(Math.min(d, 2), p => p.status === 'active' && p.clubId && CLUBS[p.clubId]?.league));
    if (!p) return null;
    const lg = CLUBS[p.clubId].league;
    const wrong = sample(BIG_CLUBS.filter(id => id !== p.clubId && CLUBS[id].league === lg && !p._clubIds.has(id)), 3).map(id => CLUBS[id].name);
    if (wrong.length < 3) return null;
    return MC('Know Your Players', `Which club was ${p.name} at going into the 2025/26 season?`, p.club, wrong, `${p.name}: ${p.club} (${lg}).`, { pid: p.id });
  },
};

const CATEGORIES = {
  'Career Paths': ['careerPath'],
  'Ever Played For?': ['playedFor', 'oddOneOut'],
  'Big Money': ['bigFee', 'feeGuess', 'peakValue'],
  'Goal Machines': ['moreGoals', 'leagueGoals', 'clGoals', 'bestSeason'],
  'Flags & Birthplaces': ['nation', 'bornIn'],
  'Know Your Players': ['oldest', 'tallest', 'leftFoot', 'capsCount', 'currentClub'],
};
const ALL_GENS = Object.values(CATEGORIES).flat();

function question(d = 2, cat = null, avoid = new Set()) {
  const gens = cat ? CATEGORIES[cat] : ALL_GENS;
  for (let i = 0; i < 60; i++) {
    const q = G[pick(gens)](d);
    if (q && q.options.length >= 2 && new Set(q.options).size === q.options.length && !avoid.has(q.q)) { avoid.add(q.q); return q; }
  }
  // fallback that always works
  return G.playedFor(1) || G.nation(1);
}

// Clue ladder for Who Am I (hardest first)
function whoAmI(d) {
  const p = pick(poolFor(d, p => realClubs(p).length >= 2 && p.nation));
  const clubs = realClubs(p);
  const posName = { GK: 'Goalkeeper', CB: 'Centre-back', LB: 'Left-back', RB: 'Right-back', DM: 'Defensive midfielder', CM: 'Central midfielder', AM: 'Attacking midfielder', LM: 'Left midfielder', RM: 'Right midfielder', LW: 'Left winger', RW: 'Right winger', ST: 'Striker', SS: 'Second striker' }[p.pos];
  const clues = [
    `${posName}${p.foot ? ', ' + p.foot + '-footed' : ''}${p.height ? ', ' + p.height + 'cm' : ''}`,
    `Born ${p.dob.slice(0, 4)}${p.birthplace ? ' in ' + p.birthplace : ''}${p.status === 'retired' ? '. Now retired' : ''}`,
    p.group === 'Goalkeeper' ? `${p.apps} senior apps, ${p.cleanSheets} clean sheets` : `${p.apps} senior apps, ${p.goals} goals, ${p.assists} assists`,
    `Peak market value ${fmtM(p.peak)}${p.caps ? `. ${p.caps} international caps` : ''}`,
    `Played for ${clubs.slice(0, Math.ceil(clubs.length / 2)).map(c => c.name).join(', ')}`,
    `Nationality: ${p.nation}. All clubs: ${clubs.map(c => c.name).join(' → ')}`,
  ];
  return { player: p, clues };
}

module.exports = { question, whoAmI, CATEGORIES, BIG_CLUBS, NATIONS, G };

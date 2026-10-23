// Loads the player database and provides lookups, fuzzy name matching and helpers.
const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'players.json'), 'utf8'));
const META = raw.meta;
const CLUBS = raw.clubs; // id -> {name,country,league}
const PLAYERS = raw.players;
const BY_ID = new Map(PLAYERS.map(p => [p.id, p]));
const TRANSFERS = raw.transfers.map(([pid, date, from, to, fee]) => ({ pid, date, from, to, fee, fromName: CLUBS[from]?.name, toName: CLUBS[to]?.name }))
  .filter(t => t.fromName && t.toName && BY_ID.has(t.pid));

const LEAGUE_NAMES = META.leagues;
const SNAPSHOT = META.snapshot;

// ---------- random helpers ----------
const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sample(a, n) { return shuffle(a).slice(0, n); }

// ---------- name normalising + matching ----------
const SPECIAL = { 'ø': 'o', 'Ø': 'o', 'ß': 'ss', 'ı': 'i', 'ł': 'l', 'Ł': 'l', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'đ': 'd', 'Đ': 'd', 'ð': 'd', 'þ': 'th' };
function norm(s) {
  return String(s || '').replace(/[øØßıłŁæÆœđĐðþ]/g, c => SPECIAL[c]).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const PARTICLES = new Set(['van', 'de', 'da', 'di', 'der', 'den', 'dos', 'das', 'do', 'del', 'la', 'le', 'el', 'al', 'von', 'ter', 'ten', 'bin', 'junior', 'jr', 'neto', 'filho']);

for (const p of PLAYERS) {
  p._n = norm(p.name);
  const t = p._n.split(' ');
  p._tokens = t;
  // "surname" = everything after the first name (or the single name)
  p._sur = t.length > 1 ? t.slice(1).join(' ') : t[0];
  p._last = t[t.length - 1];
  p._age = ageAt(p, new Date(SNAPSHOT));
  p._clubIds = new Set(p.clubs.map(c => c.id));
}

function ageAt(p, date) {
  const d = new Date(p.dob);
  let a = date.getFullYear() - d.getFullYear();
  const m = date.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && date.getDate() < d.getDate())) a--;
  return a;
}

function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
function close(a, b) {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5) return lev(a, b) <= (a.length >= 9 ? 2 : 1);
  return false;
}

// Does a typed guess identify this specific player? (full name, surname, last name, small typos)
function guessMatches(guess, p) {
  const g = norm(guess);
  if (!g) return false;
  if (close(g, p._n) || close(g, p._sur) || (p._last.length >= 3 && close(g, p._last))) return true;
  // guess is a subset of tokens in order e.g. "de bruyne" for "kevin de bruyne"
  if (g.length >= 4 && p._n.endsWith(' ' + g)) return true;
  // squashed names e.g. "debruyne"
  if (g.replace(/ /g, '') === p._sur.replace(/ /g, '')) return true;
  return false;
}

// Find players a guess could mean, optionally inside a candidate list. Best (most famous) first.
function findPlayers(guess, candidates = PLAYERS) {
  const g = norm(guess);
  if (g.length < 2) return [];
  const exact = candidates.filter(p => p._n === g);
  if (exact.length) return exact.sort((a, b) => b.fame - a.fame);
  const res = candidates.filter(p => guessMatches(g, p));
  return res.sort((a, b) => b.fame - a.fame);
}

// ---------- pools ----------
function pool(maxTier = 4, filter) {
  return PLAYERS.filter(p => p.tier <= maxTier && (!filter || filter(p)));
}
const fmtM = v => v >= 1e6 ? '€' + (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1).replace(/\.0$/, '') + 'M' : '€' + Math.round(v / 1e3) + 'K';
const seasonLabel = y => `${String(y).slice(2)}/${String(y + 1).slice(2)}`;

// value of a player at a given YYYY-MM (last recorded value on/before date; 0 if no recent record)
function valueAt(p, ym) {
  let v = null, when = null;
  for (const [d, val] of p.values) { if (d <= ym) { v = val; when = d; } else break; }
  if (v === null) return null;
  const months = (Number(ym.slice(0, 4)) - Number(when.slice(0, 4))) * 12 + (Number(ym.slice(5, 7)) - Number(when.slice(5, 7)));
  if (months > 18) return 0; // dropped off the radar / retired
  return v;
}
function clubAt(p, year) {
  const c = p.clubs.filter(c => c.from <= year && c.to >= year).sort((a, b) => b.apps - a.apps);
  return c[0]?.name || null;
}

const NATION_FLAGS = {}; // filled on client side

module.exports = { META, SNAPSHOT, CLUBS, PLAYERS, BY_ID, TRANSFERS, LEAGUE_NAMES, rand, pick, shuffle, sample, norm, guessMatches, findPlayers, pool, fmtM, seasonLabel, valueAt, clubAt, ageAt };

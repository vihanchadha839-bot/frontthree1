const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const D = require('./data');

const MODES = {};
for (const f of ['mode_imposter', 'mode_investment', 'mode_battleship', 'mode_alphabet', 'mode_whoami', 'mode_jeopardy', 'mode_chase', 'mode_trivia']) {
  const m = require('./' + f);
  MODES[m.id] = m;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

for (const f of ['index.html', 'client.js', 'style.css']) app.get('/' + (f === 'index.html' ? '' : f), (req, res) => res.sendFile(path.join(__dirname, f)));
app.get('/health', (req, res) => res.json({ ok: true, players: D.PLAYERS.length, snapshot: D.SNAPSHOT }));
// player name search for autocomplete (names only, no answers leak because every pool player is listed)
const NAME_LIST = D.PLAYERS.map(p => p.name);
app.get('/names', (req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.json(NAME_LIST); });

const rooms = new Map();
const SCALE = Number(process.env.TIME_SCALE || 1); // only for automated tests
const COLORS = ['#ffd23f', '#3bceac', '#ee4266', '#5e9cf2', '#f38d2f', '#b388eb', '#7bd389', '#ff8fab', '#4dd0e1', '#e6e6e6'];

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function publicRoom(room) {
  return {
    code: room.code, host: room.host, mode: room.mode, settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, total: p.total })),
    modes: Object.values(MODES).map(m => ({ id: m.id, name: m.name, emoji: m.emoji, blurb: m.blurb, min: m.min, max: m.max, settings: m.settings })),
    snapshot: D.SNAPSHOT, dbCount: D.PLAYERS.length,
  };
}

function sync(room) {
  const pub = publicRoom(room);
  for (const p of room.players) {
    if (!p.sid) continue;
    let view = null;
    if (room.game) {
      try { view = MODES[room.mode].view(room.game, p.id, room); } catch (e) { console.error('view error', e); }
    }
    io.to(p.sid).emit('state', { room: pub, me: p.id, game: view, now: Date.now() });
  }
}

function makeApi(room) {
  const g = () => room.game;
  const token = room.token;
  room.timers = room.timers || {};
  return {
    players: () => room.players.filter(p => p.connected || room.game?.ids?.includes(p.id)),
    name: id => room.players.find(p => p.id === id)?.name || '?',
    sync: () => sync(room),
    timer(key, ms, fn) {
      if (room.token !== token) return;
      clearTimeout(room.timers[key]);
      ms = ms * SCALE;
      room.timers[key] = setTimeout(() => { if (room.token === token && room.game) { try { fn(); } catch (e) { console.error(e); } sync(room); } }, ms);
      return Date.now() + ms;
    },
    clear(key) { clearTimeout(room.timers[key]); },
    toast(msg, to) { for (const p of room.players) if (p.sid && (!to || to === p.id)) io.to(p.sid).emit('toast', msg); },
    finish(scores) { // scores: {pid: points}
      const game = g(); if (!game) return;
      game.over = true;
      for (const p of room.players) p.total += scores[p.id] || 0;
      for (const id of game.ids || []) if (!(id in scores)) scores[id] = 0;
      game.final = Object.entries(scores).map(([id, s]) => ({ id, name: room.players.find(p => p.id === id)?.name || '?', score: s })).sort((a, b) => b.score - a.score);
    },
  };
}

function endGame(room) {
  Object.values(room.timers || {}).forEach(clearTimeout);
  room.timers = {};
  room.token = (room.token || 0) + 1;
  room.game = null;
}

io.on('connection', socket => {
  let room = null, me = null;

  socket.on('join', ({ code, name, clientId }, cb) => {
    name = String(name || '').trim().slice(0, 16) || 'Player';
    clientId = String(clientId || '').slice(0, 40);
    if (!clientId) return cb?.({ error: 'Missing id' });
    if (code) {
      room = rooms.get(String(code).toUpperCase().trim());
      if (!room) return cb?.({ error: 'Room not found' });
    } else {
      room = { code: makeCode(), host: clientId, players: [], mode: 'imposter', settings: {}, game: null };
      rooms.set(room.code, room);
    }
    me = room.players.find(p => p.id === clientId);
    if (!me) {
      if (room.players.length >= 10) return cb?.({ error: 'Room is full (10 max)' });
      if (room.game && !MODES[room.mode].lateJoin) {
        // can still join, will watch until next game
      }
      me = { id: clientId, name, color: COLORS[room.players.length % COLORS.length], total: 0 };
      room.players.push(me);
    }
    me.name = name; me.sid = socket.id; me.connected = true;
    socket.join(room.code);
    cb?.({ ok: true, code: room.code });
    if (room.game && MODES[room.mode].rejoin) MODES[room.mode].rejoin(room.game, me.id, makeApi(room));
    sync(room);
  });

  socket.on('setMode', ({ mode, settings }) => {
    if (!room || room.host !== me?.id || room.game) return;
    if (MODES[mode]) room.mode = mode;
    if (settings && typeof settings === 'object') room.settings = { ...room.settings, [room.mode]: settings };
    sync(room);
  });

  socket.on('start', () => {
    if (!room || room.host !== me?.id) return;
    const m = MODES[room.mode];
    const active = room.players.filter(p => p.connected);
    if (active.length < m.min) return socket.emit('toast', `${m.name} needs at least ${m.min} players`);
    if (active.length > m.max) return socket.emit('toast', `${m.name} allows at most ${m.max} players`);
    endGame(room);
    const defaults = Object.fromEntries((m.settings || []).map(s => [s.key, s.default]));
    const settings = { ...defaults, ...(room.settings[room.mode] || {}) };
    const ids = active.map(p => p.id);
    try {
      room.game = m.create(ids, settings, makeApi(room));
      room.game.ids = room.game.ids || ids;
    } catch (e) { console.error(e); room.game = null; socket.emit('toast', 'Could not start: ' + e.message); }
    sync(room);
  });

  socket.on('action', msg => {
    if (!room?.game || !me || !msg || typeof msg !== 'object') return;
    if (msg.type === 'end' && room.host === me.id) { endGame(room); return sync(room); }
    try { MODES[room.mode].action(room.game, me.id, msg, makeApi(room)); } catch (e) { console.error('action error', e); }
    sync(room);
  });

  socket.on('lobby', () => { if (room && room.host === me?.id) { endGame(room); sync(room); } });

  socket.on('kick', id => {
    if (!room || room.host !== me?.id || id === me.id) return;
    const p = room.players.find(p => p.id === id);
    if (p?.sid) io.to(p.sid).emit('kicked');
    room.players = room.players.filter(p => p.id !== id);
    sync(room);
  });

  socket.on('disconnect', () => {
    if (!room || !me) return;
    me.connected = false; me.sid = null;
    if (room.game && MODES[room.mode].leave) MODES[room.mode].leave(room.game, me.id, makeApi(room));
    if (room.host === me.id) {
      const next = room.players.find(p => p.connected);
      if (next) room.host = next.id;
    }
    sync(room);
    if (!room.players.some(p => p.connected)) {
      const r = room;
      setTimeout(() => { if (!r.players.some(p => p.connected)) { endGame(r); rooms.delete(r.code); } }, 10 * 60 * 1000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ball Knowledge running on ${PORT} with ${D.PLAYERS.length} players`));

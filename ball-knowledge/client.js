/* Ball Knowledge client: one page, re-renders on every server state. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtM = v => v == null ? '?' : v >= 1e6 ? '€' + (Math.round(v / 1e5) / 10).toString().replace(/\.0$/, '') + 'M' : v > 0 ? '€' + Math.round(v / 1e3) + 'K' : '€0';
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

let clientId = store.get('bk_id');
if (!clientId) { clientId = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('bk_id', clientId); }
const socket = io();
let S = null, offset = 0, NAMES = null, ui = { sel: null };

const params = new URLSearchParams(location.search);
socket.on('connect', () => {
  const code = store.get('bk_room'), name = store.get('bk_name');
  if (code && name) socket.emit('join', { code, name, clientId }, r => { if (r?.error) { store.set('bk_room', ''); render(); } });
});
socket.on('state', st => { S = st; offset = st.now - Date.now(); render(); });
socket.on('toast', toast);
socket.on('kicked', () => { store.set('bk_room', ''); S = null; render(); toast('You were removed from the room'); });

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3200);
}
const act = m => socket.emit('action', m);
const nameOf = id => S?.room.players.find(p => p.id === id)?.name || (id === 'chaser' ? 'Chaser' : '?');
const colorOf = id => S?.room.players.find(p => p.id === id)?.color || '#888';
const chip = (id, extra = '', cls = '') => `<span class="pill ${cls}"><span class="dot" style="background:${colorOf(id)}"></span>${esc(nameOf(id))}${extra}</span>`;
const isHost = () => S && S.room.host === S.me;

// ---------- countdown ----------
function timerHtml(deadline) { return deadline ? `<span class="timer" data-deadline="${deadline}">--</span>` : ''; }
setInterval(() => {
  document.querySelectorAll('[data-deadline]').forEach(el => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.deadline) - (Date.now() + offset)) / 1000));
    el.textContent = left + 's'; el.classList.toggle('low', left <= 5);
  });
}, 250);

// ---------- render with input preservation ----------
function render() {
  const app = $('#app');
  const active = document.activeElement;
  const keep = {};
  app.querySelectorAll('input[id]').forEach(i => keep[i.id] = { v: i.value, f: i === active, s: i.selectionStart });
  let html;
  if (!S) html = home();
  else if (!S.game) html = lobby();
  else html = shell(game());
  app.innerHTML = html;
  for (const [id, k] of Object.entries(keep)) {
    const el = document.getElementById(id);
    if (el && !el.dataset.reset) { el.value = k.v; if (k.f) { el.focus(); try { el.setSelectionRange(k.s, k.s); } catch {} } }
  }
  bindAutocomplete();
}

function home() {
  const code = params.get('room') || '';
  return `<div class="wrap"><div class="hero"><div class="tag">Football party games</div><h1>Ball <span>Knowledge</span></h1>
    <p>Imposter, Investment, Battleship, Alphabet, Who Am I, Jeopardy, The Chase and Trivia Path. Built on 12,000+ real players from Transfermarkt.</p></div>
    <div class="join card stack">
      <div><label class="small dim">Your name</label><input id="nm" maxlength="16" placeholder="e.g. Vihan" value="${esc(store.get('bk_name') || '')}"></div>
      <button class="go" style="width:100%" onclick="create()">Create a room</button>
      <div class="row"><input id="cd" maxlength="4" placeholder="CODE" style="text-transform:uppercase;letter-spacing:.2em" value="${esc(code)}"><button onclick="joinRoom()">Join</button></div>
    </div></div>`;
}
window.create = () => { const n = $('#nm').value.trim(); if (!n) return toast('Enter your name'); store.set('bk_name', n);
  socket.emit('join', { name: n, clientId }, r => { if (r.error) return toast(r.error); store.set('bk_room', r.code); }); };
window.joinRoom = () => { const n = $('#nm').value.trim(), c = $('#cd').value.trim().toUpperCase(); if (!n) return toast('Enter your name'); if (c.length !== 4) return toast('Room codes are 4 letters');
  store.set('bk_name', n); socket.emit('join', { code: c, name: n, clientId }, r => { if (r.error) return toast(r.error); store.set('bk_room', r.code); }); };
window.leaveRoom = () => { store.set('bk_room', ''); location.href = location.pathname; };

function topbar() {
  return `<div class="top"><div class="brand">Ball <b>Knowledge</b></div><span class="code">${S.room.code}</span>
    <span class="grow"></span>${S.game && isHost() ? `<button class="ghost small" onclick="if(confirm('End this game for everyone?'))socket.emit('lobby')">End game</button>` : ''}
    <button class="ghost small" onclick="leaveRoom()">Leave</button></div>`;
}

function lobby() {
  const R = S.room, host = isHost();
  const mode = R.modes.find(m => m.id === R.mode);
  const set = (R.settings || {})[R.mode] || {};
  const settings = (mode.settings || []).map(s => {
    const cur = set[s.key] ?? s.default;
    const opts = s.options.map(o => Array.isArray(o) ? o : [o, o]);
    return `<div><label>${esc(s.label)}</label><select ${host ? '' : 'disabled'} onchange="setSetting('${s.key}',this.value)">${opts.map(([v, l]) => `<option value='${esc(JSON.stringify(v))}' ${JSON.stringify(v) === JSON.stringify(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  }).join('');
  const link = `${location.origin}${location.pathname}?room=${R.code}`;
  return topbar() + `<div class="wrap stack">
    <div class="card"><div class="row wrapflex"><h2 style="font-size:24px">Squad</h2><span class="grow"></span>
      <button class="ghost small" onclick="navigator.clipboard?.writeText('${link}');toast('Invite link copied')">Copy invite link</button></div>
      <div class="spacer"></div><div class="players">${R.players.map(p => `<span class="pill" style="opacity:${p.connected ? 1 : .4}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === R.host ? ' 👑' : ''}${p.total ? ` · ${p.total}pts` : ''}${host && p.id !== S.me ? ` <a style="cursor:pointer;color:var(--mute)" onclick="socket.emit('kick','${p.id}')">✕</a>` : ''}</span>`).join('')}</div></div>
    <div><div class="row" style="margin-bottom:10px"><h2 style="font-size:24px">Pick a game</h2><span class="grow"></span>${host ? '' : '<span class="small dim">The host picks</span>'}</div>
      <div class="modes">${R.modes.map(m => `<button class="mode ${m.id === R.mode ? 'sel' : ''}" ${host ? `onclick="socket.emit('setMode',{mode:'${m.id}'})"` : ''}>
        <div class="e">${m.emoji}</div><h3>${esc(m.name)}</h3><p>${esc(m.blurb)}</p><p class="mute" style="margin-top:6px">${m.min === m.max ? m.min : m.min + '–' + m.max} players</p></button>`).join('')}</div></div>
    <div class="card stack"><div class="row"><h3 style="font-size:22px">${mode.emoji} ${esc(mode.name)}</h3></div>
      ${settings ? `<div class="settings">${settings}</div>` : ''}
      ${host ? `<button class="go" style="width:100%;font-size:17px" onclick="socket.emit('start')">Kick off</button>` : `<div class="banner">Waiting for the host to kick off</div>`}</div>
    <p class="small mute center">Player data: Transfermarkt snapshot from ${esc(R.snapshot)} (${R.dbCount.toLocaleString()} players). Stats count senior club games in all competitions.</p>
  </div>`;
}
window.setSetting = (k, v) => {
  const R = S.room; const cur = { ...((R.settings || {})[R.mode] || {}) }; cur[k] = JSON.parse(v);
  socket.emit('setMode', { mode: R.mode, settings: cur });
};

function shell(inner) {
  return topbar() + `<div class="wrap">${inner}</div>`;
}
function finalBlock(final, extra = '') {
  if (!final) return '';
  return `<div class="card stack" style="margin-top:14px"><h2 style="font-size:30px">Full time</h2>${extra}
    <div class="podium">${final.map((f, i) => `<div class="pl"><span class="pos">${i + 1}</span><span class="dot" style="background:${colorOf(f.id)}"></span><span class="grow">${esc(f.name)}</span><span class="mono">+${f.score}</span></div>`).join('')}</div>
    ${isHost() ? `<button class="go" style="width:100%" onclick="socket.emit('lobby')">Back to lobby</button>` : '<div class="banner">Waiting for the host…</div>'}</div>`;
}
function scoreBar(scores, turnId) {
  if (!scores) return '';
  return `<div class="scorebar">${Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([id, s]) => chip(id, ` <span class="mono">${s}</span>`, id === turnId ? 'turn' : '')).join('')}</div>`;
}
function head(title, g, extra = '') {
  return `<div class="gamehead"><h2>${title}</h2>${timerHtml(g.deadline)}<span class="grow"></span>${extra}</div>`;
}
function optsHtml(q, { onPick, reveal = null, mine = null, disabled = false, marks = {} }) {
  return `<div class="opts">${q.options.map((o, i) => {
    let cls = 'opt';
    if (reveal !== null && reveal !== undefined) { if (i === reveal) cls += ' right'; else if (i === mine) cls += ' wrong'; }
    if (i === mine && (reveal === null || reveal === undefined)) cls += ' mine';
    return `<button class="${cls}" ${disabled || reveal != null ? 'disabled' : ''} onclick="${onPick}(${i})">${esc(o)}${marks[i] || ''}</button>`;
  }).join('')}</div>`;
}

// ---------- autocomplete ----------
async function loadNames() { if (!NAMES) { NAMES = []; const r = await fetch('/names'); NAMES = (await r.json()).map(n => [n, n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()]); } }
function bindAutocomplete() {
  document.querySelectorAll('input[data-ac]').forEach(inp => {
    if (inp._ac) return; inp._ac = true; loadNames();
    const box = inp.parentElement; let list = null, idx = -1, items = [];
    const close = () => { list?.remove(); list = null; idx = -1; };
    inp.addEventListener('input', () => {
      const q = inp.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      close(); if (q.length < 3 || !NAMES) return;
      items = NAMES.filter(([, n]) => n.startsWith(q) || n.includes(' ' + q)).slice(0, 7).map(x => x[0]);
      if (!items.length) return;
      list = document.createElement('ul');
      list.innerHTML = items.map(n => `<li>${esc(n)}</li>`).join('');
      list.querySelectorAll('li').forEach((li, i) => li.onmousedown = e => { e.preventDefault(); inp.value = items[i]; close(); inp.form?.requestSubmit(); });
      box.appendChild(list);
    });
    inp.addEventListener('keydown', e => {
      if (!list) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === idx)); }
      if (e.key === 'Enter' && idx >= 0) { inp.value = items[idx]; close(); }
      if (e.key === 'Escape') close();
    });
    inp.addEventListener('blur', () => setTimeout(close, 120));
  });
}
function textForm(id, placeholder, onsubmit, { ac = false, button = 'Send', max = 40 } = {}) {
  return `<form class="row" onsubmit="event.preventDefault();const v=this.querySelector('input').value.trim();if(!v)return;${onsubmit}(v);this.querySelector('input').value='';">
    <div class="ac grow"><input id="${id}" maxlength="${max}" autocomplete="off" placeholder="${esc(placeholder)}" ${ac ? 'data-ac="1"' : ''}></div><button class="go">${button}</button></form>`;
}

// ---------- modes ----------
function game() {
  const g = S.game;
  const fn = { imposter, investment, battleship, alphabet, whoami, jeopardy, chase, trivia }[g.type];
  return fn ? fn(g) : '<p>Unknown mode</p>';
}

/* Imposter */
function imposter(g) {
  const me = S.me, s = g.secret;
  const secret = !s ? '<div class="banner">Spectating</div>' : s.imposter
    ? `<div class="pcard" style="border-color:var(--red)"><div class="tag" style="color:var(--red)">You are the</div><div class="big" style="color:var(--red)">Imposter</div><div class="meta" style="margin-top:6px">Blend in. Listen to the clues and work out who it is.${s.hint ? `<br><b style="color:var(--ink)">Hint: ${esc(s.hint)}</b>` : ''}</div></div>`
    : `<div class="pcard"><div class="tag">Secret player</div><div class="nm" style="font-size:30px">${esc(s.name)}</div><div class="meta">${esc(s.pos)} · ${esc(s.nation)} · born ${s.born} · ${esc(s.club)}</div><div class="meta" style="margin-top:4px">${esc(s.clubs.join(' → '))}</div></div>`;
  let main = '';
  if (g.phase === 'reveal') main = `<div class="banner volt">Check your card. Clues start in a sec…</div>`;
  if (g.phase === 'clues') main = g.turnId === me
    ? `<div class="stack"><div class="banner volt">Your clue (lap ${g.lap + 1}/${g.laps}). Keep it short and don't give it away.</div>${textForm('clue', 'One word or a short clue', 'sendClue', { max: 40 })}</div>`
    : `<div class="banner">${esc(nameOf(g.turnId))} is thinking of a clue…</div>`;
  if (g.phase === 'vote') main = `<div class="stack"><div class="banner volt">Vote for the imposter</div><div class="opts">${g.order.filter(id => id !== me).map(id => `<button class="opt ${g.myVote === id ? 'mine' : ''}" onclick="act({type:'vote',target:'${id}'})">${chip(id)}</button>`).join('')}</div>
    <div class="small dim">${g.voted.length}/${g.order.length} voted</div></div>`;
  if (g.phase === 'steal') main = g.stealing === me
    ? `<div class="stack"><div class="banner red">Caught! Guess the secret player to steal 2 points</div>${textForm('steal', 'Who is it?', 'sendSteal', { ac: true, button: 'Guess' })}</div>`
    : `<div class="banner">${esc(nameOf(g.stealing))} was caught! They get one guess at the player…</div>`;
  if (g.result) {
    const r = g.result;
    main = `<div class="stack"><div class="banner ${r.caught ? 'green' : 'red'}">${chip(r.imposter)} was the imposter. ${r.caught ? (r.stole ? `Caught, but stole it with "${esc(r.guess)}"!` : `Caught!${r.guess ? ` Guessed "${esc(r.guess)}" ✗` : ''}`) : 'Got away with it!'}</div>
      <div class="small dim">Points: ${Object.entries(r.pts).map(([id, p]) => `${esc(nameOf(id))} +${p}`).join(', ') || 'none'}</div>
      ${!g.over ? (isHost() ? `<button class="go" onclick="act({type:'next'})">${g.round >= g.rounds ? 'Final scores' : 'Next round'}</button>` : '<div class="small dim">Host starts the next round</div>') : ''}</div>`;
  }
  const clues = `<div class="card"><div class="tag">Clues</div><div class="log">${g.clues.length ? g.clues.map(c => `<div>${chip(c.pid)} ${esc(c.text)}</div>`).join('') : '<div class="dim">No clues yet</div>'}</div></div>`;
  const votes = g.voteResult ? `<div class="card"><div class="tag">Votes</div>${Object.entries(g.voteResult.count).map(([id, n]) => `<div>${chip(id)} ${'🗳️'.repeat(n)}</div>`).join('') || '<div class="dim">No votes</div>'}</div>` : '';
  return head(`Imposter · round ${g.round}/${g.rounds}`, g, scoreBar(g.scores, g.turnId)) +
    `<div class="two"><div class="stack">${g.result && s?.imposter ? `<div class="pcard"><div class="tag">It was</div><div class="nm">${esc(g.result.player.name)}</div></div>` : secret}${main}</div><div class="stack">${clues}${votes}</div></div>` + finalBlock(g.final);
}
window.sendClue = v => act({ type: 'clue', text: v });
window.sendSteal = v => act({ type: 'steal', text: v });

/* Investment */
function pcard(c, btn, extra = '') {
  const delta = c.prev ? c.value - c.prev : 0;
  return `<div class="pcard ${c.owned ? 'owned' : ''}"><div class="row"><span class="pos">${esc(c.pos)}</span><span class="grow"></span><span class="small dim">${esc(c.nation)}</span></div>
    <div class="nm">${c.name ? esc(c.name) : '???'}</div><div class="meta">Age ${c.age} · ${esc(c.club)}</div>
    <div class="val">${fmtM(c.value)} ${c.prev ? (delta === 0 ? '<span class="small dim">no change in a year</span>' : `<span class="small ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${fmtM(Math.abs(delta))} in a year</span>`) : '<span class="small dim">new to the market</span>'}</div>${extra}${btn || ''}</div>`;
}
function investment(g) {
  const me = g.me;
  const stats = me ? `<div class="row wrapflex"><span class="pill">💶 Cash <span class="mono">${fmtM(me.cash)}</span></span><span class="pill">📈 Net worth <span class="mono">${fmtM(me.worth)}</span></span><span class="pill">Window ${Math.min(g.window + 1, g.windows)}/${g.windows}</span><span class="pill">Cash out: summer ${g.finalYear}</span></div>` : '';
  let body = '';
  if (g.phase === 'market') {
    body = `<div class="banner volt">It's summer ${g.year}. ${g.blind ? 'Names are hidden. ' : ''}Buy players at their real value then. Next jump: ${g.window + 1 < g.windows ? g.years[g.window + 1] : g.finalYear}.</div>
      <div class="market">${g.market.map(c => pcard(c, c.owned ? `<button class="ghost" style="width:100%;margin-top:8px" onclick="act({type:'sell',id:${c.id}})">Sell back</button>` : `<button class="go" style="width:100%;margin-top:8px" ${me.cash < c.value ? 'disabled' : ''} onclick="act({type:'buy',id:${c.id}})">Buy ${fmtM(c.value)}</button>`)).join('')}</div>
      ${me.holdings.length ? `<div class="card"><div class="tag">Your portfolio (sell at ${g.year} value)</div><div class="market" style="margin-top:8px">${me.holdings.map(c => pcard(c, `<button class="ghost" style="width:100%;margin-top:8px" onclick="act({type:'sell',id:${c.id}})">Sell ${fmtM(c.value)}</button>`, `<div class="small dim">Paid ${fmtM(c.paid)}</div>`)).join('')}</div></div>` : ''}
      <button class="${me.ready ? 'ghost' : 'go'}" style="width:100%" onclick="act({type:'ready'})">${me.ready ? 'Waiting for others… (tap to undo)' : 'Done, jump forward ⏩'}</button>
      <div class="small dim">${g.ready.length} ready: ${g.ready.map(nameOf).map(esc).join(', ')}</div>`;
  } else {
    const rep = (g.report || []).map(r => `<div class="row"><span class="grow">${esc(r.name)}</span><span class="mono dim">${fmtM(r.then)}</span> → <span class="mono ${r.now >= r.then ? 'up' : 'down'}">${fmtM(r.now)}</span></div>`).join('') || '<div class="dim">You held nobody.</div>';
    body = `<div class="banner volt">${g.phase === 'final' ? `Cash out! Values as of summer ${g.finalYear}` : `Time jump: ${g.reportFrom.slice(0, 4)} → ${g.reportTo.slice(0, 4)}`}</div>
      <div class="two"><div class="card"><div class="tag">Your players</div><div class="log">${rep}</div></div>
      <div class="card"><div class="tag">Rich list</div>${(g.table || []).map((t, i) => `<div class="row" style="padding:5px 0"><b>${i + 1}</b>${chip(t.id)}<span class="grow"></span><span class="mono">${fmtM(t.worth)}</span></div>`).join('')}</div></div>
      ${g.phase === 'report' && isHost() ? `<button class="go" onclick="act({type:'next'})">Open next window now</button>` : ''}
      ${g.allReports ? `<div class="card"><div class="tag">Everyone's final portfolio</div>${Object.entries(g.allReports).map(([id, list]) => `<div style="padding:6px 0;border-bottom:1px dashed var(--line)">${chip(id)} ${list.length ? list.map(r => `<span class="small">${esc(r.name)} <span class="mono ${r.now >= r.paid ? 'up' : 'down'}">${fmtM(r.paid)}→${fmtM(r.now)}</span></span>`).join(' · ') : '<span class="small dim">all cash</span>'}</div>`).join('')}</div>` : ''}`;
  }
  return head(`Investment · ${g.phase === 'market' ? g.year : g.phase === 'final' ? 'final' : 'jump'}`, g) + `<div class="stack">${stats}${body}</div>` + finalBlock(g.final, '<div class="small dim">Places: 1st +5, 2nd +3, 3rd +2, others +1</div>');
}

/* Battleship */
function battleship(g) {
  const myTurn = g.turnId === S.me && g.phase === 'play';
  const sel = ui.sel;
  let grid = `<div class="hdr"></div>${g.nations.map(n => `<div class="hdr">${esc(n)}</div>`).join('')}`;
  g.cells.forEach((row, r) => {
    grid += `<div class="hdr rowh">${esc(g.clubs[r])}</div>`;
    row.forEach((c, ci) => {
      const cls = ['cell', c.shot ? 'shot' : '', c.shot && !c.hit ? 'miss' : '', c.hit ? 'hit' : '', c.sunk ? 'sunk' : '', !c.shot && c.ship != null && g.phase === 'over' ? 'reveal' : '', sel && sel[0] === r && sel[1] === ci ? 'sel' : ''].join(' ');
      const inner = c.shot ? `<span class="ic">${c.hit ? (c.sunk ? '💥' : '🔥') : '💧'}</span>${esc(c.player)}` : (g.answers ? `<span style="font-size:9px;opacity:.8">${esc(g.answers[r][ci][0] || '')}</span>` : '');
      grid += `<div class="${cls}" ${myTurn && !c.shot ? `onclick="pickCell(${r},${ci})" style="cursor:pointer"` : ''}>${inner}</div>`;
    });
  });
  const ships = g.ships.map((len, i) => `<span class="pill" style="${g.sunkShips[i] ? 'text-decoration:line-through;opacity:.5' : ''}">${'▮'.repeat(len)}</span>`).join('');
  let ctl = '';
  if (g.phase === 'play') ctl = myTurn
    ? (sel ? `<div class="stack"><div class="banner volt">Fire at ${esc(g.clubs[sel[0]])} × ${esc(g.nations[sel[1]])}: name a player</div>${textForm('fire', 'Player name', 'fire', { ac: true, button: 'Fire 🚀' })}</div>`
      : '<div class="banner volt">Your turn! Tap a square</div>')
    : `<div class="banner">${esc(nameOf(g.turnId))} is aiming…</div>`;
  if (g.phase === 'over') ctl = '<div class="banner green">All done! Squares show one example answer.</div>';
  return head('Battleship', g, scoreBar(g.scores, g.turnId)) + `<div class="two"><div class="stack"><div class="bgrid">${grid}</div><div class="row wrapflex"><span class="small dim">Fleet:</span>${ships}</div></div>
    <div class="stack">${ctl}<div class="card"><div class="tag">Shots</div><div class="log">${g.log.map(l => `<div>${chip(l.pid)} ${esc(l.text)}</div>`).join('') || '<div class="dim">No shots yet</div>'}</div></div>
    <div class="small dim">Name a player who played for the club (row) and represents the nation (column). Hit +1, sink +2 more. Each player can only be used once.</div></div></div>` + finalBlock(g.final);
}
window.pickCell = (r, c) => { ui.sel = [r, c]; render(); setTimeout(() => $('#fire')?.focus(), 30); };
window.fire = v => { if (!ui.sel) return; act({ type: 'fire', r: ui.sel[0], c: ui.sel[1], text: v }); ui.sel = null; };

/* Alphabet */
function alphabet(g) {
  const myTurn = g.turnId === S.me;
  const letters = `<div class="letters">${g.letters.map((L, i) => `<span class="${i < g.li ? 'done' : i === g.li && g.phase === 'play' ? 'now' : ''}">${L}</span>`).join('')}</div>`;
  const lives = `<div class="scorebar">${g.order.map(id => chip(id, ` <span class="hearts">${'❤️'.repeat(Math.max(0, g.lives[id]))}${g.alive.includes(id) ? '' : ' OUT'}</span> <span class="mono">${g.scores[id]}</span>`, id === g.turnId ? 'turn' : '')).join('')}</div>`;
  let ctl = '';
  if (g.phase === 'play') ctl = myTurn
    ? `<div class="stack"><div class="banner volt">Your go: a surname starting with <b style="font-size:22px">${g.letter}</b></div>${textForm('alpha', `${g.letter}…`, 'sendAlpha', { button: 'Go' })}</div>`
    : `<div class="banner">${esc(nameOf(g.turnId))} needs a <b>${g.letter}</b>…</div>`;
  const missed = g.missed ? `<div class="card"><div class="tag">You could have said</div><div class="small" style="columns:2">${g.missed.map(m => `<div><b>${m.L}</b> ${esc(m.ex.join(', ') || '-')}</div>`).join('')}</div></div>` : '';
  return head('Alphabet', g) + `<div class="stack"><div class="card"><div class="tag">Category</div><div class="big">${esc(g.cat)}</div></div>${letters}${lives}${ctl}
    <div class="card"><div class="log">${g.log.map(l => `<div>${chip(l.pid)} ${l.letter ? `<b>${l.letter}</b>` : ''} <span class="${l.ok ? 'ok' : 'bad'}">${esc(l.text)}</span></div>`).join('') || '<div class="dim">A is up first</div>'}</div></div>${missed}</div>` + finalBlock(g.final);
}
window.sendAlpha = v => act({ type: 'answer', text: v });

/* Who Am I */
function whoami(g) {
  const can = g.phase === 'play' && !g.solvedMe && g.myGuesses.length < 3;
  const clues = g.clues.map((c, i) => `<div class="clue"><b>${i + 1}</b>${esc(c)}</div>`).join('');
  let ctl = '';
  if (g.phase === 'play') ctl = g.solvedMe ? `<div class="banner green">Got it! +${g.solvedMe}</div>` : can
    ? `<div class="stack"><div class="small dim">Worth ${g.worth} points right now · ${3 - g.myGuesses.length} guesses left</div>${textForm('who', 'Who is it?', 'sendWho', { ac: true, button: 'Guess' })}</div>`
    : '<div class="banner red">Out of guesses</div>';
  const mine = g.myGuesses.map(x => `<span class="pill ${x.ok ? 'ok' : 'bad'}">${esc(x.text)} ${x.ok ? '✓' : '✗'}</span>`).join(' ');
  const reveal = g.reveal ? `<div class="pcard"><div class="tag">It was</div><div class="nm" style="font-size:30px">${esc(g.reveal.name)}</div><div class="meta">${esc(g.reveal.nation)} · ${esc(g.reveal.clubs.join(' → '))}</div></div>
    ${!g.over && g.phase === 'reveal' ? (isHost() ? `<button class="go" onclick="act({type:'next'})">${g.round >= g.rounds ? 'Final scores' : 'Next player'}</button>` : '<div class="small dim">Host moves on</div>') : ''}` : '';
  return head(`Who Am I · ${g.round}/${g.rounds}`, g, scoreBar(g.scores)) + `<div class="two"><div class="stack">${clues}${g.phase === 'play' && g.clues.length < g.total ? `<div class="small mute">Next clue ${timerHtml(g.deadline)}</div>` : ''}${reveal}</div>
    <div class="stack">${ctl}<div>${mine}</div><div class="small dim">${g.solved.length ? 'Solved: ' + g.solved.map(nameOf).map(esc).join(', ') : ''}</div></div></div>` + finalBlock(g.final);
}
window.sendWho = v => act({ type: 'guess', text: v });

/* Jeopardy */
function jeopardy(g) {
  const cols = g.cats.length;
  let board = `<div class="jboard" style="grid-template-columns:repeat(${cols},1fr)">${g.cats.map(c => `<div class="jcat">${esc(c)}</div>`).join('')}`;
  for (let r = 0; r < 5; r++) for (let c = 0; c < cols; c++) {
    const d = g.board[c][r].done;
    board += `<button class="jcell ${d ? 'done' : ''}" ${!d && g.phase === 'board' && g.picker === S.me ? `onclick="act({type:'pick',c:${c},r:${r}})"` : 'disabled'}>${g.values[r]}</button>`;
  }
  board += '</div>';
  let main = '';
  if (g.phase === 'board') main = `<div class="banner ${g.picker === S.me ? 'volt' : ''}">${g.picker === S.me ? 'Your pick! Choose a square' : `${esc(nameOf(g.picker))} is picking`}</div>${board}`;
  else {
    const c = g.cur;
    const myBuzz = g.buzzer === S.me && g.phase === 'answer';
    let ctl = '';
    if (g.phase === 'buzz') ctl = g.locked.includes(S.me) ? '<div class="banner red">You are locked out</div>' : `<button class="buzz" onclick="act({type:'buzz'})">BUZZ</button>`;
    if (g.phase === 'answer') ctl = myBuzz ? `<div class="banner volt">You buzzed! Pick your answer</div>` : `<div class="banner">${esc(nameOf(g.buzzer))} buzzed in…</div>`;
    const marks = {}; (c.answers || []).forEach(a => { if (a.choice >= 0) marks[a.choice] = (marks[a.choice] || '') + ` <span class="dot" style="background:${colorOf(a.pid)}"></span>`; });
    main = `<div class="card stack"><div class="row"><span class="tag">${esc(c.cat)} · ${c.value}</span>${c.double ? '<span class="pill" style="background:var(--volt);color:#151300">DAILY DOUBLE</span>' : ''}</div>
      <div class="q">${esc(c.q)}</div>
      ${c.options ? optsHtml({ options: c.options }, { onPick: 'jAns', reveal: c.answer, disabled: !myBuzz, marks }) : ''}
      ${ctl}${g.phase === 'reveal' ? `<div class="banner ${c.winner ? 'green' : ''}">${c.winner ? `${esc(nameOf(c.winner))} +${c.value}` : 'Nobody got it'}</div><div class="fact">${esc(c.fact)}</div>` : ''}</div>`;
  }
  return head('Jeopardy', g, scoreBar(g.scores, g.picker)) + main + finalBlock(g.final, '<div class="small dim">Session points = board score ÷ 100</div>');
}
window.jAns = i => act({ type: 'answer', choice: i });

/* The Chase */
function chase(g) {
  const c = g.cur, me = S.me;
  const isC = c?.pid === me, isCh = g.chaserId === me;
  const chaserLabel = `<span class="pill" style="background:var(--red)">😈 ${esc(g.chaserName)}</span>`;
  let main = '';
  const ladder = c && c.pos != null ? `<div class="ladder">${Array.from({ length: g.home + 1 }, (_, i) => {
    const cls = i === g.home ? 'home' : i === c.pos ? 'c' : i === c.chaser ? 'ch' : '';
    const lbl = i === g.home ? 'HOME' : i === c.pos ? `${esc(nameOf(c.pid))} · ${fmtM(c.bank)}` : i === c.chaser ? `😈 ${esc(g.chaserName)}` : '';
    return `<div class="rung ${cls}">${lbl}</div>`; }).join('')}</div>` : '';
  if (g.phase === 'cash') main = isC
    ? `<div class="stack"><div class="banner volt">Cash builder! €5K a correct answer. Bank: ${fmtM(c.bank)}</div>
      ${c.last ? `<div class="small ${c.last.ok ? 'ok' : 'bad'}">${c.last.ok ? 'Correct!' : `Nope, it was ${esc(c.last.answer)}`}</div>` : ''}
      <div class="q">${esc(c.q.q)}</div>${optsHtml(c.q, { onPick: 'cAns' })}</div>`
    : `<div class="stack"><div class="banner">${esc(nameOf(c.pid))} is building cash… ${fmtM(c.bank)} (${c.correct} right)</div>${c.q ? `<div class="q dim">${esc(c.q.q)}</div>${optsHtml(c.q, { onPick: 'cAns', disabled: true })}` : ''}</div>`;
  if (g.phase === 'offer') main = isC
    ? `<div class="stack"><div class="banner volt">${chaserLabel} makes you an offer</div><div class="row">
      <button class="offer" style="background:var(--red)" onclick="act({type:'offer',key:'high'})"><div class="small">HIGH · one step closer</div><div class="big">${fmtM(g.offers.high.bank)}</div></button>
      <button class="offer" style="background:var(--blue);color:#05152f" onclick="act({type:'offer',key:'mid'})"><div class="small">KEEP IT</div><div class="big">${fmtM(g.offers.mid.bank)}</div></button>
      <button class="offer" style="background:var(--pitch);color:#06220f" onclick="act({type:'offer',key:'low'})"><div class="small">LOW · one step ahead</div><div class="big">${fmtM(g.offers.low.bank)}</div></button></div></div>`
    : `<div class="banner">${esc(nameOf(c.pid))} is weighing up the offers…</div>`;
  if (g.phase === 'h2h' || g.phase === 'h2hReveal') {
    const rv = c.reveal;
    const can = g.phase === 'h2h' && (isC || isCh) && c.mine === undefined;
    const marks = {};
    if (rv) { if (rv.contestant != null && rv.contestant >= 0) marks[rv.contestant] = ' 🔵'; if (rv.chaser != null && rv.chaser >= 0) marks[rv.chaser] = (marks[rv.chaser] || '') + ' 😈'; }
    main = `<div class="two"><div class="card stack"><div class="tag">${esc(c.q.cat)}</div><div class="q">${esc(c.q.q)}</div>
      ${optsHtml(c.q, { onPick: 'cAns', reveal: rv ? rv.answer : null, mine: (isC || isCh) ? (c.mine ?? null) : null, disabled: !can, marks })}
      <div class="small dim">${c.answered.contestant ? '🔵 locked in' : '🔵 thinking'} · ${c.answered.chaser ? '😈 locked in' : '😈 thinking'}</div>
      ${rv ? `<div class="fact">${esc(rv.fact)}</div>${rv.outcome ? `<div class="banner ${rv.outcome === 'home' ? 'green' : 'red'}">${rv.outcome === 'home' ? `${esc(nameOf(c.pid))} is HOME with ${fmtM(c.bank)}!` : `CAUGHT! ${esc(nameOf(c.pid))} is out`}</div>` : ''}` : ''}</div><div>${ladder}</div></div>`;
  }
  if (g.phase === 'final') {
    const f = g.fc;
    main = `<div class="stack"><div class="banner volt">FINAL CHASE · team ${g.survivors.map(nameOf).map(esc).join(', ')} · pot ${fmtM(g.pot)}</div><div class="big center">${f.steps} steps</div>
      ${f.q ? `<div class="q">${esc(f.q.q)}</div>${optsHtml(f.q, { onPick: 'cAns' })}` : '<div class="banner">The team is answering. Get ready to chase.</div>'}</div>`;
  }
  if (g.phase === 'finalChase') {
    const f = g.fc;
    main = `<div class="stack"><div class="banner red">${esc(g.chaserName)} needs ${f.target} to catch the team</div><div class="big center">${f.chaser} / ${f.target}</div>
      <div class="center mono">${(f.chaserLog || []).join(' ')}</div>${f.q ? `<div class="q">${esc(f.q.q)}</div>${optsHtml(f.q, { onPick: 'cAns' })}` : ''}</div>`;
  }
  if (g.phase === 'over') main = `<div class="banner ${g.winner === 'team' ? 'green' : 'red'}">${g.winner === 'team' ? `The team beat the Chaser and split ${fmtM(g.pot)}!` : `${esc(g.chaserName)} wins!`}</div>`;
  const results = g.results.length ? `<div class="small dim">${g.results.map(r => `${esc(nameOf(r.pid))}: ${r.outcome === 'home' ? '✅ home' : '❌ caught'}`).join(' · ')}</div>` : '';
  return head('The Chase', g, chaserLabel) + `<div class="stack">${main}${results}<div class="small mute">Contestants: ${g.contestants.map(nameOf).map(esc).join(', ')}</div></div>` + finalBlock(g.final);
}
window.cAns = i => act({ type: 'answer', choice: i });

/* Trivia Path */
function trivia(g) {
  const order = []; // snake board, 36 at top-left
  for (let row = 5; row >= 0; row--) { const r = Array.from({ length: 6 }, (_, i) => row * 6 + i + 1); order.push(...(row % 2 ? r.reverse() : r)); }
  const board = `<div class="board">${order.map(n => {
    const cls = n === g.size ? 'fin' : g.ladders[n] ? 'lad' : g.snakes[n] ? 'snk' : '';
    const toks = g.order.filter(id => g.pos[id] === n).map(id => `<span class="tok" style="background:${colorOf(id)}"></span>`).join('');
    return `<div class="sq ${cls}"><span>${n}${g.ladders[n] ? ` 🪜${g.ladders[n]}` : g.snakes[n] ? ` 🐍${g.snakes[n]}` : n === g.size ? ' 🏆' : ''}</span><span class="toks">${toks}</span></div>`;
  }).join('')}</div>`;
  const start = g.order.filter(id => g.pos[id] === 0).map(id => chip(id)).join(' ');
  const c = g.cur, mine = c?.pid === S.me;
  let ctl = '';
  if (g.phase === 'roll') ctl = g.turnId === S.me ? `<button class="go" style="width:100%;font-size:20px" onclick="act({type:'roll'})">🎲 Roll</button>` : `<div class="banner">${esc(nameOf(g.turnId))} to roll</div>`;
  if (c && g.phase !== 'roll') {
    const what = { normal: `Answer right to move to ${c.to}`, ladder: `Ladder on ${c.to}! Get it right to climb`, snake: `Snake on ${c.to}! Get it right to dodge it`, finish: 'Final question for the win!' }[c.kind];
    ctl = `<div class="card stack"><div class="row"><span class="dice">${'⚀⚁⚂⚃⚄⚅'[g.dice - 1]}</span><div><b>${esc(nameOf(c.pid))}</b> rolled ${g.dice}<div class="small dim">${what}</div></div></div>
      <div class="tag">${esc(c.q.cat)}</div><div class="q">${esc(c.q.q)}</div>${optsHtml(c.q, { onPick: 'tAns', reveal: c.answer, mine: c.result ? c.result.choice : null, disabled: !mine })}
      ${c.result ? `<div class="banner ${c.result.ok ? 'green' : 'red'}">${esc(nameOf(c.pid))} ${esc(c.result.note)}</div><div class="fact">${esc(c.fact)}</div>` : ''}</div>`;
  }
  return head('Trivia Path', g, `<div class="scorebar">${g.order.map(id => chip(id, ` <span class="mono">${g.pos[id]}</span>`, id === g.turnId ? 'turn' : '')).join('')}</div>`) +
    `<div class="two"><div class="stack">${board}${start ? `<div class="small dim">At the start: ${start}</div>` : ''}</div><div class="stack">${ctl}<div class="card"><div class="log">${g.log.map(l => `<div>${chip(l.pid)} ${esc(l.text)}</div>`).join('') || '<div class="dim">First to 36 wins</div>'}</div></div></div></div>` + finalBlock(g.final);
}
window.tAns = i => act({ type: 'answer', choice: i });

render();

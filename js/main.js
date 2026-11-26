/* SWAPFILE — game controller: loop, input, inspector, swaps/pointers, rewind, menus, progress */
(function () {
  'use strict';
  const E = window.Engine, R = window.Render, A = window.Audio2;
  const { LEVELS, ACTS } = window.SWAP_LEVELS;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // ---------------- persistence ----------------
  const KEY = 'swapfile.save.v1';
  let save = { done: {}, frags: {}, muted: false, last: 0, seenActs: {} };
  try { Object.assign(save, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} };
  // v1 saves were keyed by level index (15-level build); v2 keys by level name
  if (!save.v) {
    const OLD = ['hello_world.c', 'restitution.c', 'gravity_scale.c', 'mass.c', 'upside_down.c', 'breakpoint.c', 'const_door.c', 'type_pun.c', 'velocity.c', 'elevator.c', 'pointer.c', 'shared_memory.c', 'const_cast.c', 'gc_sweep.c', 'free(gc).c'];
    const mig = o => { const r = {}; for (const k in o) r[/^\d+$/.test(k) && OLD[+k] ? OLD[+k] : k] = o[k]; return r; };
    save.done = mig(save.done || {}); save.frags = mig(save.frags || {}); save.v = 2; save.last = 0;
    try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {}
  }
  const unlocked = i => i < 2 || !!save.done[LEVELS[i - 1].name] || !!save.done[LEVELS[i - 2].name];
  save.settings = Object.assign({ music: 80, sfx: 90, crt: true, bloom: true, shake: true, trace: true }, save.settings || {});

  // ---------------- state ----------------
  const G = {
    screen: 'boot', li: 0, lv: null, st: null, history: [],
    paused: true, slowKey: false, slowMouse: false, rewind: false,
    acc: 0, alpha: 1, time: 0, mode: 'swap',
    cardA: null, cardB: null, armed: null, hover: null, mouse: null,
    trace: null, traceDirty: true, deathT: 0, deathMsg: '', wonT: 0, winShown: false,
    attract: false, attractTimer: 0, hintLevel: 0, usedHint: false, rewinds: 0,
    throttle: {}, stepSnd: 0, tipShown: false,
  };
  const speed = () => (G.slowKey || G.slowMouse) ? 0.1 : 1;

  // ---------------- DOM refs ----------------
  const canvas = $('#game'), stage = $('#stage'), cardsEl = $('#cards'), logEl = $('#log');
  const tl = $('#tl'), tlc = tl.getContext('2d');
  R.init(canvas);

  // ---------------- layout ----------------
  function layout() {
    const wrap = $('#stageWrap').getBoundingClientRect();
    const maxW = wrap.width - 28, maxH = wrap.height - 34;
    let w = Math.min(maxW, maxH * (R.LW / R.LH));
    w = Math.max(320, Math.floor(w));
    const h = Math.floor(w * R.LH / R.LW);
    stage.style.width = w + 'px'; stage.style.height = h + 'px';
    R.resize(w, h);
    const d = Math.min(window.devicePixelRatio || 1, 2);
    tl.width = Math.round(w * d); tl.height = Math.round(12 * d);
  }
  window.addEventListener('resize', layout);
  const L2C = () => stage.clientWidth / R.LW; // logical px -> css px

  // ---------------- console ----------------
  const MAXLOG = 80;
  function log(type, html) {
    const d = document.createElement('div');
    d.className = 'l ' + type;
    const ts = G.st ? (G.st.frame / 60).toFixed(2).padStart(6, '0') : '--.--';
    d.innerHTML = `<span class="ts">${ts}</span>` + html;
    logEl.appendChild(d);
    while (logEl.children.length > MAXLOG) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
    return d;
  }
  function logOnce(key, type, html, secs) {
    const now = G.time;
    if (G.throttle[key] && now - G.throttle[key] < (secs || 4)) return;
    G.throttle[key] = now;
    log(type, html);
  }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let typeQueue = [], typing = null;
  function typeLines(lines, cls) {
    lines.forEach(l => typeQueue.push({ text: l, cls: cls || 'dev' }));
    if (!typing) typeNext();
  }
  function typeNext() {
    const item = typeQueue.shift();
    if (!item) { typing = null; return; }
    const el = log(item.cls, '');
    const span = document.createElement('span'); el.appendChild(span);
    let i = 0;
    typing = setInterval(() => {
      i += 2;
      span.textContent = item.text.slice(0, i);
      if (i % 4 === 0) A.sfx('type');
      logEl.scrollTop = logEl.scrollHeight;
      if (i >= item.text.length) { clearInterval(typing); typing = null; setTimeout(typeNext, 160); }
    }, 16);
  }
  function clearTyping() { typeQueue = []; if (typing) clearInterval(typing); typing = null; }

  // ---------------- level lifecycle ----------------
  function loadLevel(i, opts) {
    opts = opts || {};
    G.li = i; G.lv = LEVELS[i];
    G.st = E.load(G.lv);
    G.history = [E.snapshot(G.st)];
    G.paused = true; G.acc = 0; G.rewind = false;
    G.deathT = 0; G.wonT = 0; G.winShown = false; G.hintLevel = 0; G.usedHint = false; G.rewinds = 0;
    G.mode = 'swap'; G.throttle = {};
    closeCards();
    for (const e of G.st.ents) { e.px = e.x; e.py = e.y; }
    R.particles = []; R.texts = []; R.ripples = [];
    R.pix.bubble = null;
    R.buildStatic(G.st, G.lv.act);
    if (!opts.attract) { R.trans = 1; R.transText = 'ld -o build/' + G.lv.name.replace(/\.c$/, '.o') + ' ...'; A.sfx('whoosh'); }
    G.traceDirty = true;
    A.setAct(G.lv.act, !!G.lv.gc);
    const act = ACTS[G.lv.act - 1];
    document.documentElement.style.setProperty('--accent', act.color);
    G.accent = act.color;
    if (opts.attract) return;
    save.last = i; persist();
    $('#hud-act').textContent = 'ACT ' + ['I', 'II', 'III', 'IV', 'V'][G.lv.act - 1] + ' · ' + act.title;
    $('#hud-level').innerHTML = `<b>${G.lv.id}</b> ${esc(G.lv.name)}`;
    $('#hud-mode').classList.toggle('hidden', !G.lv.pointers);
    setMode('swap');
    logEl.innerHTML = '';
    log('sys', `$ gdb ./sunny_meadows --heap=${act.heap} --level=${G.lv.id}`);
    log('info', `Loaded <b>${esc(G.lv.name)}</b> · ${G.st.ents.length} objects · par ${G.lv.par} swap${G.lv.par > 1 ? 's' : ''}${G.lv.ram != null ? ' · RAM ' + G.lv.ram : ''}${G.lv.pointers ? ' · <span style="color:var(--vec)">pointers enabled</span>' : ''}`);
    clearTyping();
    typeLines(G.lv.intro || [], G.lv.act === 4 ? 'sys' : 'dev');
    showTip(G.lv.tip);
    if (!save.seenActs[G.lv.act] || opts.splash) {
      save.seenActs[G.lv.act] = true; persist();
      showActSplash(act);
    }
  }
  function restart() {
    if (!G.lv) return;
    const keepTip = !$('#tip').classList.contains('hidden');
    loadLevel(G.li, {});
    if (!keepTip) $('#tip').classList.add('hidden');
  }

  function showTip(html) {
    const t = $('#tip');
    if (!html) { t.classList.add('hidden'); return; }
    t.innerHTML = html + '<span class="close">✕</span>';
    t.classList.remove('hidden');
    t.querySelector('.close').onclick = () => t.classList.add('hidden');
  }
  function showActSplash(act) {
    const s = $('#actSplash');
    s.innerHTML = `<div class="a1">${act.heap} · HEAP SEGMENT</div><div class="a2" style="color:${act.color}">${act.title}</div><div class="a3">${act.sub}</div>`;
    s.classList.remove('hidden');
    s.style.animation = 'none'; void s.offsetWidth; s.style.animation = '';
    clearTimeout(showActSplash.t);
    showActSplash.t = setTimeout(() => s.classList.add('hidden'), 2900);
  }

  // ---------------- simulation step ----------------
  function doStep() {
    const st = G.st;
    for (const e of st.ents) { e.px = e.x; e.py = e.y; }
    const ev = E.step(st);
    G.history[st.frame] = E.snapshot(st);
    G.history.length = st.frame + 1;
    if (!G.attract) handleEvents(ev);
    else handleEventsQuiet(ev);
  }

  const T = 32;
  const wc = () => { const w = G.st.walker; return [(w.x + w.w / 2) * T, (w.y + w.h / 2) * T]; };
  const ecx = e => [(e.x + e.w / 2) * T, (e.y + e.h / 2) * T];

  function handleEventsQuiet(ev) {
    for (const e of ev) {
      if (e.type === 'land') R.squash(0.35);
      if (e.type === 'bounce' && e.e) { const [x, y] = ecx(e.e); R.ripple(x, y - 8, '#4dff9a', 40); }
      if (e.type === 'win') { const [x, y] = wc(); R.burst(x, y, '#7dffe9', 40, { speed: 4, g: 0 }); }
    }
  }

  function handleEvents(ev) {
    const st = G.st, w = st.walker;
    for (const e of ev) {
      switch (e.type) {
        case 'jump': A.sfx('jump'); R.squash(-0.25); dust(); break;
        case 'land': A.sfx('land'); R.squash(Math.min(0.5, 0.15 + e.impact)); dust(); if (e.impact > 0.3) R.shake = Math.max(R.shake, 3); break;
        case 'bounce': {
          A.sfx('bounce'); R.squash(-0.35);
          if (e.e) { const [x, y] = ecx(e.e); R.ripple(x, e.e.y * T, '#4dff9a', 50); R.burst(x, e.e.y * T, '#4dff9a', 12, { dir: -Math.PI / 2, spread: 1.4, speed: 3 }); }
          if (Math.random() < 0.35) R.say(['wheee!', 'boing', 'woah'][Math.floor(Math.random() * 3)], 0.9);
          break;
        }
        case 'turn': {
          if (e.why === 'wall') { A.sfx('turn'); if (e.e) logOnce('wall' + e.e.id, 'info', `PIX.dir *= -1 &nbsp;// collided with <b>${e.e.id}</b> (Is_Solid == TRUE)`); }
          else if (e.why === 'ledge') { A.sfx('turn'); R.say('?', 0.7); logOnce('ledge', 'info', 'PIX.dir *= -1 &nbsp;// gap &gt; max_jump (2 tiles) and drop &gt; 3 tiles'); }
          else if (e.why === 'hazard_below') { R.say('nope', 0.8); logOnce('hzb' + (e.e && e.e.id), 'warn', `[WARN] PIX refused drop: <b>${e.e ? e.e.id : '?'}</b>.Is_Hazard == TRUE below`); }
          else if (e.why === 'moving_floor') { R.say('hm', 0.6); logOnce('mvf', 'info', 'PIX will not jump from a moving floor'); }
          break;
        }
        case 'panic': {
          A.sfx('panic'); R.say('!!', 0.9);
          logOnce('pan' + e.e.id, 'warn', `[WARN] PIX panic: <b>${e.e.id}</b>.Is_Hazard == TRUE within ${E.C.SIGHT} tiles &rarr; Walk_Dir *= -1`);
          break;
        }
        case 'push': if (st.frame % 10 === 0) A.sfx('push'); break;
        case 'thud': A.sfx('thud', e.impact); R.shake = Math.max(R.shake, e.impact * 14); { const [x] = ecx(e.e); R.burst(x, (e.e.y + e.e.h) * T, 'rgba(200,210,255,0.8)', 8, { dir: -Math.PI / 2, spread: 2.6, speed: 2 }); } break;
        case 'shatter': {
          A.sfx('shatter'); R.shake = Math.max(R.shake, 7); R.glitch = Math.max(R.glitch, 0.3);
          const o = e.e;
          for (let i = 0; i < o.w * 3; i++) R.burst((o.x + Math.random() * o.w) * T, (o.y + Math.random() * o.h) * T, i % 2 ? 'rgba(190,235,255,0.9)' : 'rgba(255,255,255,0.8)', 2, { shape: 'shard', size: 5, speed: 3, decay: 0.012 });
          log('warn', `[WARN] ${o.id} deallocated (${o.kind === 'laser' ? 'collector lock released' : 'impact &gt; tolerance'})`);
          break;
        }
        case 'reverse': break;
        case 'oob': {
          const o = e.e;
          log('warn', `[WARN] <b>${o.id}</b> left the heap (y=${o.y.toFixed(1)}). Object unreachable.`);
          if (E.get(st, o, 'exit')) log('err', `[ERROR] Exit object lost &mdash; level cannot complete. Rewind (Z) or restart (R).`);
          break;
        }
        case 'collected': {
          const o = e.e; A.sfx('collected');
          for (let i = 0; i < 10; i++) R.burst((o.x + Math.random() * o.w) * T, (o.y + Math.random() * o.h) * T, '#ff6a3d', 1, { speed: 1.5, g: -0.05, decay: 0.03 });
          logOnce('gc' + o.id, 'sys', `[GC] free(${o.id}) &mdash; 0x${o.addr.toString(16).toUpperCase()} reclaimed`, 99);
          if (E.get(st, o, 'exit')) log('err', '[ERROR] the Collector freed the exit.');
          break;
        }
        case 'frag': {
          A.sfx('frag');
          const [x, y] = ecx(e.e);
          R.burst(x, y, '#ffe066', 26, { speed: 3.5, g: 0.02, decay: 0.025 });
          R.floatText(x, y - 10, '+ DATA FRAGMENT', '#ffe066');
          log('frag', `[DATA] ${esc(e.e.note || 'fragment recovered')}`);
          break;
        }
        case 'win': {
          A.sfx('win'); R.say(':D', 2);
          const [x, y] = wc();
          R.burst(x, y, '#7dffe9', 60, { speed: 5, g: 0.02, decay: 0.015 });
          R.burst(x, y, '#ffe066', 30, { speed: 3, g: 0, decay: 0.02, shape: 'ring', size: 6 });
          R.flash = 1; R.flashColor = '#7dffe9';
          log('ok', `[OK] PIX reached <b>${e.e.id}</b> (Is_Exit == TRUE) &middot; cycles=${st.frame} swaps=${st.swaps}`);
          G.wonT = 0;
          break;
        }
        case 'die': {
          A.sfx('die'); R.shake = 12; R.glitch = 1; R.flash = 1; R.flashColor = '#ff2b4a';
          const [x, y] = wc();
          R.burst(x, y, '#ffe9a8', 30, { speed: 4, decay: 0.015 });
          R.burst(x, y, '#ff3d6e', 30, { speed: 5, decay: 0.02 });
          const by = e.by ? e.by.id : null;
          G.deathMsg = ({
            hazard: `SIGSEGV · PIX touched ${by}.Is_Hazard == TRUE`,
            void: 'SIGSEGV · PIX fell out of the heap (y > 17)',
            overflow: 'STACK OVERFLOW · PIX left the top of the stack',
            crush: `CRUSHED · PIX embedded in solid memory${by ? ' (' + by + ')' : ''}`,
            collected: 'PIX WAS GARBAGE COLLECTED',
            loop: 'INFINITE LOOP · PIX wrapped around the heap forever',
          })[e.reason] || 'core dumped';
          log('err', `[FATAL] ${G.deathMsg} &nbsp;&mdash; hold <kbd>Z</kbd> to rewind`);
          G.deathT = 0;
          break;
        }
        case 'wrap': {
          A.sfx('wrap'); R.glitch = Math.max(R.glitch, 0.5);
          const [x, y] = wc();
          R.burst(x, y, G.accent || '#ffc93d', 16, { speed: 3, g: 0, decay: 0.03 });
          logOnce('wrap', 'warn', '[WARN] integer overflow: PIX coordinates wrapped around the heap', 6);
          break;
        }
        case 'gcfreed': {
          A.sfx('gcfreed'); R.flash = 1; R.flashColor = '#ffffff'; R.shake = 16; R.glitch = 1.2;
          log('ok', '[GC] free(gc) &mdash; the Collector has been deallocated. heap usage 12%.');
          break;
        }
      }
    }
    // footstep ticks
    if (w.grounded && Math.abs(w.vx) > 0.01) { if (++G.stepSnd % 16 === 0) A.sfx('step'); }
  }
  function dust() {
    const w = G.st.walker; const g = E.get(G.st, w, 'gravity');
    const fy = (g < 0 ? w.y : w.y + w.h) * T;
    R.burst((w.x + w.w / 2) * T, fy, 'rgba(220,220,255,0.6)', 6, { dir: g < 0 ? Math.PI / 2 : -Math.PI / 2, spread: 2.8, speed: 1.4, g: 0.02, size: 2.5 });
  }

  // ---------------- prediction trace (breakpoint mode) ----------------
  let simState = null;
  function computeTrace() {
    G.traceDirty = false;
    if (!G.st || G.st.status === 'dead' || G.st.status === 'won') { G.trace = null; return; }
    if (!simState || simState.level !== G.lv) simState = E.load(G.lv);
    E.restore(simState, E.snapshot(G.st));
    const pts = [];
    for (let i = 0; i < 260; i++) {
      E.step(simState);
      const w = simState.walker;
      if (i % 3 === 0) pts.push({ x: w.x + w.w / 2, y: w.y + w.h / 2 });
      if (simState.status === 'dead') { pts.push({ x: w.x + w.w / 2, y: Math.min(w.y + w.h / 2, 16.8), dead: true }); break; }
      if (simState.status === 'won') { pts.push({ x: w.x + w.w / 2, y: w.y + w.h / 2, win: true }); break; }
    }
    G.trace = pts;
  }

  // ---------------- swaps / pointers ----------------
  function setMode(m) {
    if (m === 'ptr' && !(G.lv && G.lv.pointers)) m = 'swap';
    G.mode = m;
    $$('#hud-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    G.armed = null;
    refreshCards();
  }

  function canArm(e, p) {
    if (G.mode === 'ptr') return true; // sources may be const
    return !e.lock[p];
  }

  function onRow(id, p, rowEl) {
    const st = G.st, e = st.byId[id];
    if (!e || !e.alive) return;
    A.init();
    if (!G.armed) {
      if (!canArm(e, p)) {
        A.sfx('error'); rowEl.classList.remove('shake'); void rowEl.offsetWidth; rowEl.classList.add('shake');
        log('err', `[ERROR] CONST_VIOLATION: <b>${id}.${E.PROP_LABEL[p]}</b> is read-only${G.lv.pointers ? ' &mdash; but you can still <i>point</i> at it (TAB)' : ''}`);
        return;
      }
      G.armed = { id, p };
      A.sfx('arm');
      refreshCards();
      return;
    }
    const a = G.armed;
    if (a.id === id && a.p === p) { G.armed = null; A.sfx('disarm'); refreshCards(); return; }
    if (E.TYPES[a.p] !== E.TYPES[p]) {
      if (canArm(e, p)) { G.armed = { id, p }; A.sfx('arm'); refreshCards(); }
      else { A.sfx('error'); log('err', `[ERROR] TYPE_MISMATCH: cannot assign ${E.TYPES[p]} to ${E.TYPES[a.p]}`); }
      return;
    }
    doOp(a.id, a.p, id, p, rowEl);
  }

  function doOp(aId, pa, bId, pb, rowEl) {
    const st = G.st;
    if (st.status === 'won') return;
    const ptr = G.mode === 'ptr';
    const a = st.byId[aId], b = st.byId[bId];
    const va = E.fmt(E.get(st, a, pa), E.TYPES[pa]), vb = E.fmt(E.get(st, b, pb), E.TYPES[pb]);
    const err = ptr ? E.pointer(st, aId, pa, bId, pb) : E.swap(st, aId, pa, bId, pb);
    if (err) {
      A.sfx('error');
      if (rowEl) { rowEl.classList.remove('shake'); void rowEl.offsetWidth; rowEl.classList.add('shake'); }
      const why = {
        CONST_VIOLATION: 'target field is const (read-only)',
        OUT_OF_MEMORY: `RAM exhausted (${G.lv.ram}/${G.lv.ram}). Rewind (Z) to free memory.`,
        SAME_ADDRESS: 'both names already point at the same memory',
        TYPE_MISMATCH: 'types differ', NULL_REFERENCE: 'object no longer exists',
      }[err] || err;
      log('err', `[ERROR] ${err}: ${why}`);
      return;
    }
    // success
    if (st.status === 'dead') { /* allowed but pointless */ }
    G.history[st.frame] = E.snapshot(st);
    G.history.length = st.frame + 1;
    G.traceDirty = true;
    A.sfx(ptr ? 'ptr' : 'swap');
    R.glitch = Math.max(R.glitch, 0.35); R.flash = 0.5; R.flashColor = R.TYPE_COLOR[E.TYPES[pa]];
    const [x0, y0] = ecx(a), [x1, y1] = ecx(b);
    const col = R.TYPE_COLOR[E.TYPES[pa]];
    R.burst(x0, y0, col, 14, { speed: 2.5, g: 0 }); R.burst(x1, y1, col, 14, { speed: 2.5, g: 0 });
    R.ripple(x0, y0, col, 40); R.ripple(x1, y1, col, 40);
    if (ptr) {
      R.floatText(x1, y1 - 18, `&${aId}.${pa}`, col);
      log('op', `[PTR] ${bId}.${E.PROP_LABEL[pb]} = &amp;${aId}.${E.PROP_LABEL[pa]} &nbsp;<span style="color:var(--dim)">// now reads ${va}${a.lock[pa] ? ' (from const memory)' : ''}</span>`);
    } else {
      R.floatText(x0, y0 - 18, vb, col); R.floatText(x1, y1 - 18, va, col);
      log('op', `[SWAP] ${aId}.${E.PROP_LABEL[pa]} &lt;-&gt; ${bId}.${E.PROP_LABEL[pb]} &nbsp;<span style="color:var(--dim)">// ${va} &#8644; ${vb}</span>`);
      // const_cast detection: writing through an alias that also names const memory
      [[a, pa], [b, pb]].forEach(([o, p]) => {
        const cell = o.ref[p];
        for (const q of st.ents) for (const k of E.PROP_ORDER) {
          if ((q !== o || k !== p) && q.ref[k] === cell && q.lock[k]) log('warn', `[WARN] const_cast: write through alias modified <b>${q.id}.${E.PROP_LABEL[k]}</b> (const) &rarr; ${E.fmt(st.cells[cell], E.TYPES[k])}`);
        }
      });
    }
    diagnose(a, pa); diagnose(b, pb);
    G.armed = null;
    closeCards();
    if (G.lv.ram != null && st.swaps >= G.lv.ram) logOnce('ramfull', 'warn', `[WARN] RAM full (${st.swaps}/${G.lv.ram}). Rewind to reclaim.`, 1);
  }

  // compiler-warning style hints after an op
  function diagnose(o, p) {
    const st = G.st, v = E.get(st, o, p);
    if (o.kind === 'walker' && p === 'gravity' && v < 0) log('info', '// PIX.gravity < 0 &rarr; PIX will fall UP');
    if (o.kind === 'walker' && p === 'gravity' && v > 0 && v < 0.3) log('info', '// low gravity: PIX will drift. bounces go very high.');
    if (o.kind === 'walker' && p === 'gravity' && v === 0) log('warn', '[WARN] PIX.gravity == 0 &rarr; PIX floats in a straight line');
    if (p === 'exit' && !v && o.kind === 'door') log('warn', `[WARN] ${o.id}.Is_Exit == FALSE &mdash; the door is just a doorway now`);
    if (p === 'bounce' && v > 2) log('warn', `[WARN] ${o.id}.Restitution = ${E.fmt(v, 'float')} exceeds spring tolerance (clamped launch)`);
    if (p === 'solid' && !v && E.get(st, o, 'exit')) log('info', `// ${o.id} is non-solid: PIX must overlap it to exit`);
  }

  // ---------------- inspector cards ----------------
  const LOCK_SVG = '<svg viewBox="0 0 16 16"><path d="M4 7V5a4 4 0 118 0v2h1v8H3V7h1zm2 0h4V5a2 2 0 10-4 0v2z"/></svg>';
  const GROUPS = [['PHYSICS · f32', ['gravity', 'bounce', 'mass']], ['VECTOR · vec2', ['velocity']], ['FLAGS · bool', ['solid', 'hazard', 'exit']]];
  const TSHORT = { float: 'f32', bool: 'bool', vec: 'vec2' };

  function aliasMap() {
    const m = {};
    for (const e of G.st.ents) for (const p of e.schema) { const c = e.ref[p]; (m[c] = m[c] || []).push(e.id + '.' + p); }
    return m;
  }

  function buildCard(e, kind) {
    const el = document.createElement('div');
    el.className = 'card ' + kind + (G.mode === 'ptr' ? ' ptrmode' : '');
    el.dataset.id = e.id;
    const am = aliasMap();
    let html = `<div class="card-h"><span class="addr">0x${e.addr.toString(16).toUpperCase().padStart(4, '0')}</span><span class="cls">${e.cls}</span><span class="id">"${e.id}"</span></div>`;
    for (const [gname, props] of GROUPS) {
      const ps = props.filter(p => e.schema.indexOf(p) >= 0);
      if (!ps.length) continue;
      html += `<div class="grp">${gname}</div>`;
      for (const p of ps) {
        const t = E.TYPES[p];
        const shared = (am[e.ref[p]] || []).filter(n => n !== e.id + '.' + p);
        html += `<div class="row${e.lock[p] ? ' locked' : ''}" data-p="${p}" data-type="${t}">
          <span class="t">${TSHORT[t]}</span><span class="k">${E.PROP_LABEL[p]}</span>
          ${shared.length ? `<span class="sh" title="shares memory with ${shared.join(', ')}">⇄${shared.length}</span>` : ''}
          <span class="v"></span><span class="lk">${e.lock[p] ? LOCK_SVG : ''}</span></div>`;
      }
    }
    const notes = [];
    if (e.kind === 'walker') notes.push('Autonomous. Walks forward, turns at walls, jumps gaps &le; 2, flees hazards within 3 tiles.');
    if (e.fragile) notes.push('Fragile: shatters under mass &ge; 2 on impact.');
    if (e.kind === 'gc') notes.push('<b>Deletes anything it touches.</b>');
    if (e.pickup) notes.push('Recovered data. Walk PIX into it.');
    if (e.bindGc) notes.push('Held by the Collector\'s lock.');
    const sharedAny = e.schema.some(p => (am[e.ref[p]] || []).length > 1);
    if (sharedAny) notes.push('<span style="color:var(--vec)">⇄ = field shares memory via pointer</span>');
    if (notes.length) html += `<div class="foot">${notes.join('<br>')}</div>`;
    el.innerHTML = html;
    el.querySelectorAll('.row').forEach(r => {
      r.addEventListener('mousedown', ev => { ev.stopPropagation(); ev.preventDefault(); if (ev.button === 0) onRow(e.id, r.dataset.p, r); });
      r.addEventListener('mouseenter', () => A.sfx('hover'));
    });
    el.addEventListener('mousedown', ev => ev.stopPropagation());
    el.addEventListener('contextmenu', ev => ev.preventDefault());
    return el;
  }

  function kernelCard() {
    const el = document.createElement('div');
    el.className = 'card kernel preview';
    el.innerHTML = `<div class="card-h"><span class="addr">0x0000</span><span class="cls">KERNEL::Terrain</span></div><div class="foot">Engine geometry. Read-only kernel memory. Always solid.</div>`;
    return el;
  }

  function updateCardValues(el) {
    const e = G.st.byId[el.dataset.id];
    if (!e) return;
    el.querySelectorAll('.row').forEach(r => {
      const p = r.dataset.p, t = E.TYPES[p];
      const v = E.get(G.st, e, p);
      const vs = r.querySelector('.v');
      const txt = E.fmt(v, t);
      if (vs.textContent !== txt) vs.textContent = txt;
      if (t === 'bool') vs.className = 'v ' + (v ? 'T' : 'F');
      // armed / compat classes
      const a = G.armed;
      r.classList.toggle('armed', !!a && a.id === e.id && a.p === p);
      if (a && !(a.id === e.id && a.p === p)) {
        const ok = E.TYPES[a.p] === t && !e.lock[p] && !(G.st.byId[a.id].ref[a.p] === e.ref[p]);
        r.classList.toggle('compat', ok);
        r.classList.toggle('incompat', !ok);
      } else { r.classList.toggle('compat', G.li === 0 && !a && p === 'hazard' && !e.lock[p] && G.st.swaps === 0); r.classList.remove('incompat'); }
    });
  }

  function placeCard(el, e, slot) {
    const k = L2C();
    const [ex, ey] = R.entPos(e, G.alpha);
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const cw = el.offsetWidth || 236, ch = el.offsetHeight || 200;
    let x = (ex + e.w) * 32 * k + 14, y = ey * 32 * k - 10;
    if (x + cw > sw - 6) x = ex * 32 * k - cw - 14;
    if (x < 6) x = 6;
    if (slot === 'b' && G.cardA) {
      const ar = { x: G.cardA.offsetLeft, y: G.cardA.offsetTop, w: G.cardA.offsetWidth, h: G.cardA.offsetHeight };
      if (x < ar.x + ar.w && x + cw > ar.x && y < ar.y + ar.h && y + ch > ar.y) {
        // try other side
        const alt = ar.x > sw / 2 ? ar.x - cw - 10 : ar.x + ar.w + 10;
        x = Math.max(6, Math.min(sw - cw - 6, alt));
      }
    }
    y = Math.max(6, Math.min(sh - ch - 6, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }

  function openCard(slot, e) {
    const el = buildCard(e, slot);
    cardsEl.appendChild(el);
    if (slot === 'a') { if (G.cardA) G.cardA.remove(); G.cardA = el; }
    else { if (G.cardB) G.cardB.remove(); G.cardB = el; }
    updateCardValues(el);
    placeCard(el, e, slot);
  }
  function closeCards() {
    if (G.cardA) G.cardA.remove(); if (G.cardB) G.cardB.remove();
    if (G.hoverCard) G.hoverCard.remove();
    G.cardA = G.cardB = G.hoverCard = null; G.hoverCardId = null;
    G.armed = null;
  }
  function refreshCards() {
    // rebuild pinned cards (mode / alias changes)
    if (!G.st) return;
    const a = G.cardA && G.st.byId[G.cardA.dataset.id];
    const b = G.cardB && G.st.byId[G.cardB.dataset.id];
    const armed = G.armed;
    if (a) openCard('a', a); if (b) openCard('b', b);
    G.armed = armed;
    if (G.hoverCard) { G.hoverCard.remove(); G.hoverCard = null; G.hoverCardId = null; }
  }

  function syncHoverCard() {
    const h = G.hover;
    const pinned = [G.cardA && G.cardA.dataset.id, G.cardB && G.cardB.dataset.id];
    let want = null;
    if (h && h !== '__terrain' && pinned.indexOf(h) < 0) want = h;
    if (h === '__terrain' && !G.armed) want = '__terrain';
    if (want !== G.hoverCardId) {
      if (G.hoverCard) G.hoverCard.remove();
      G.hoverCard = null; G.hoverCardId = want;
      if (want === '__terrain') { G.hoverCard = kernelCard(); cardsEl.appendChild(G.hoverCard); }
      else if (want) { const e = G.st.byId[want]; G.hoverCard = buildCard(e, 'preview'); cardsEl.appendChild(G.hoverCard); }
    }
    if (G.hoverCard) {
      if (want === '__terrain' && G.mouse) {
        const k = L2C();
        G.hoverCard.style.left = Math.min(stage.clientWidth - 210, G.mouse.x * k + 16) + 'px';
        G.hoverCard.style.top = Math.max(4, G.mouse.y * k - 50) + 'px';
      } else if (want) { const e = G.st.byId[want]; updateCardValues(G.hoverCard); placeCard(G.hoverCard, e, 'b'); }
    }
  }

  // ---------------- input ----------------
  function toLogical(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * R.LW, y: (ev.clientY - r.top) / r.height * R.LH };
  }
  function hitTest(lx, ly) {
    if (!G.st) return null;
    const tx = lx / 32, ty = ly / 32;
    let best = null, bestA = Infinity;
    const pad = 0.15;
    for (const e of G.st.ents) {
      if (!e.alive) continue;
      const [ex, ey] = R.entPos(e, G.alpha);
      if (tx >= ex - pad && tx <= ex + e.w + pad && ty >= ey - pad && ty <= ey + e.h + pad) {
        let area = e.w * e.h;
        if (e.kind === 'walker') area *= 0.3;
        if (e.kind === 'gc') area *= 4;
        if (area < bestA) { bestA = area; best = e.id; }
      }
    }
    if (best) return best;
    const c = Math.floor(tx), r = Math.floor(ty);
    if (r >= 0 && r < G.st.H && c >= 0 && c < G.st.W && G.st.grid[r][c]) return '__terrain';
    return null;
  }

  canvas.addEventListener('mousemove', ev => {
    if (G.screen !== 'play') return;
    G.mouse = toLogical(ev);
    const h = hitTest(G.mouse.x, G.mouse.y);
    if (h !== G.hover && h && h !== '__terrain') A.sfx('hover');
    G.hover = h;
  });
  canvas.addEventListener('mouseleave', () => { G.hover = null; G.mouse = null; });
  canvas.addEventListener('mousedown', ev => {
    A.init();
    if (G.screen !== 'play') return;
    if (ev.button === 2) { G.slowMouse = true; return; }
    if (ev.button !== 0) return;
    const m = toLogical(ev);
    const h = hitTest(m.x, m.y);
    if (!h || h === '__terrain') {
      if (G.armed) { G.armed = null; A.sfx('disarm'); }
      closeCards(); return;
    }
    const e = G.st.byId[h];
    A.sfx('select');
    if (G.armed) {
      if (G.cardA && G.cardA.dataset.id === h) return;
      openCard('b', e);
    } else {
      if (G.cardB) { G.cardB.remove(); G.cardB = null; }
      if (G.cardA && G.cardA.dataset.id === h) { closeCards(); return; }
      openCard('a', e);
    }
    if (G.hoverCard) { G.hoverCard.remove(); G.hoverCard = null; G.hoverCardId = null; }
  });
  window.addEventListener('mouseup', ev => { if (ev.button === 2) G.slowMouse = false; });
  canvas.addEventListener('contextmenu', ev => ev.preventDefault());

  // timeline scrub
  let scrubbing = false;
  function scrubTo(ev) {
    const r = tl.getBoundingClientRect();
    const f = tlWindow();
    const frame = Math.round(f.start + (ev.clientX - r.left) / r.width * (f.end - f.start));
    const target = Math.max(0, Math.min(G.history.length - 1, frame));
    if (G.history[target]) {
      E.restore(G.st, G.history[target]);
      for (const e of G.st.ents) { e.px = e.x; e.py = e.y; }
      G.history.length = target + 1;
      G.paused = true; G.traceDirty = true; G.winShown = false;
      $('#win').classList.add('hidden');
    }
  }
  tl.addEventListener('mousedown', ev => { if (G.screen !== 'play' || G.st.status === 'won') return; scrubbing = true; scrubTo(ev); A.sfx('rewind'); });
  window.addEventListener('mousemove', ev => { if (scrubbing) scrubTo(ev); });
  window.addEventListener('mouseup', () => { scrubbing = false; });

  function togglePause() {
    if (!G.st || G.st.status === 'won') return;
    if (G.st.status === 'dead') return;
    G.paused = !G.paused;
    if (!G.paused) { $('#tip').classList.add('hidden'); A.sfx('select'); }
    else { G.traceDirty = true; A.sfx('disarm'); }
  }

  window.addEventListener('keydown', ev => {
    A.init();
    const k = ev.key;
    if (G.screen === 'boot') { finishBoot(); return; }
    if (!$('#settings').classList.contains('hidden')) { if (k === 'Escape') closeSettings(); return; }
    if (G.screen === 'ending') return;
    if (G.screen === 'title') { if (k === 'Enter' || k === ' ') { ev.preventDefault(); $('#m-continue').click(); } return; }
    if (G.screen === 'select' || G.screen === 'datalog') { if (k === 'Escape') { ev.preventDefault(); if (G.lv && G.prevScreen === 'play') showScreen('play'); else showScreen('title'); } return; }
    if (G.screen === 'win') {
      if (k === 'Enter' || k === 'n' || k === 'N' || k === ' ') { ev.preventDefault(); $('#w-next').click(); }
      else if (k === 'r' || k === 'R') $('#w-retry').click();
      else if (k === 'Escape') $('#w-map').click();
      else if (k === 'z' || k === 'Z') { $('#win').classList.add('hidden'); G.screen = 'play'; G.rewind = true; }
      return;
    }
    if (G.screen !== 'play') return;
    if (k === ' ') { ev.preventDefault(); togglePause(); }
    else if (k === 'Shift') G.slowKey = true;
    else if (k === 'z' || k === 'Z' || k === 'Backspace') { ev.preventDefault(); if (!G.rewind) { G.rewinds++; } G.rewind = true; }
    else if (k === 'r' || k === 'R') restart();
    else if (k === 'h' || k === 'H') hint();
    else if (k === 'Tab') { ev.preventDefault(); if (G.lv.pointers) { setMode(G.mode === 'swap' ? 'ptr' : 'swap'); A.sfx('select'); log('info', `mode: <b>${G.mode === 'ptr' ? 'POINTER' : 'SWAP'}</b>${G.mode === 'ptr' ? ' &mdash; pick a SOURCE (may be const), then a TARGET (writable)' : ''}`); } }
    else if (k === 'Escape') { if (G.armed || G.cardA) { closeCards(); A.sfx('disarm'); } else openSelect(); }
    else if (k === 'm' || k === 'M') toggleMute();
    else if (k === 'Enter' && G.st.status === 'won') showWin();
  });
  window.addEventListener('keyup', ev => {
    if (ev.key === 'Shift') G.slowKey = false;
    if (ev.key === 'z' || ev.key === 'Z' || ev.key === 'Backspace') {
      if (G.rewind) { G.rewind = false; G.paused = true; G.traceDirty = true; }
    }
  });
  window.addEventListener('blur', () => { G.slowKey = false; G.slowMouse = false; if (G.rewind) { G.rewind = false; G.paused = true; } });

  $('#btn-run').onclick = () => { A.init(); togglePause(); };
  $('#btn-reset').onclick = () => { A.init(); restart(); };
  $('#btn-hint').onclick = () => { A.init(); hint(); };
  $('#btn-mute').onclick = () => { A.init(); toggleMute(); };
  $('#btn-menu').onclick = () => { A.init(); openSelect(); };
  $$('#hud-mode button').forEach(b => b.onclick = () => { setMode(b.dataset.mode); A.sfx('select'); });

  function toggleMute() {
    save.muted = !save.muted; persist();
    A.setMuted(save.muted);
    $('#btn-mute').classList.toggle('off', save.muted);
  }

  function hint() {
    if (!G.lv) return;
    G.usedHint = true;
    const sol = G.lv.solution;
    G.hintLevel = Math.min(G.hintLevel + 1, sol.length + 1);
    if (G.hintLevel === 1) {
      const kinds = new Set();
      sol.forEach(s => { kinds.add(s[2].split('.')[0]); kinds.add(s[3].split('.')[0]); });
      log('warn', `// hint 1: look closely at <b>${[...kinds].join('</b>, <b>')}</b>`);
    } else {
      const s = sol[G.hintLevel - 2];
      const [a, pa] = s[2].split('.'), [b, pb] = s[3].split('.');
      const when = s[0] === 0 ? 'before running' : `while running, around cycle ${s[0]} (~${(s[0] / 60).toFixed(1)}s)`;
      const txt = s[1] === 'ptr'
        ? `POINTER: ${b}.${E.PROP_LABEL[pb]} = &amp;${a}.${E.PROP_LABEL[pa]}`
        : `SWAP: ${a}.${E.PROP_LABEL[pa]} &lt;-&gt; ${b}.${E.PROP_LABEL[pb]}`;
      log('warn', `// hint ${G.hintLevel}: ${txt} &nbsp;(${when})`);
      if (G.hintLevel - 1 >= sol.length) log('info', '// that is the full solution.');
    }
  }

  // ---------------- HUD ----------------
  function updateHUD() {
    const st = G.st;
    if (!st) return;
    const s = $('#hud-state');
    let txt, cls;
    if (G.rewind) { txt = '◀◀ REWIND'; cls = 'rew'; }
    else if (st.status === 'dead') { txt = '✖ SEGFAULT'; cls = 'dead'; }
    else if (st.status === 'won') { txt = '✔ COMPILED'; cls = 'run'; }
    else if (G.paused) { txt = st.frame === 0 ? '■ BREAKPOINT' : '⏸ PAUSED'; cls = ''; }
    else if (speed() < 1) { txt = '◷ SLOW-MO 10%'; cls = 'slow'; }
    else { txt = '▶ RUNNING'; cls = 'run'; }
    if (s.textContent !== txt) { s.textContent = txt; s.className = 'state ' + cls; }
    $('#hud-cycle').textContent = 'CYCLE ' + String(st.frame).padStart(6, '0');
    const ram = G.lv.ram;
    let r = '';
    if (ram != null) {
      r = 'RAM ';
      for (let i = 0; i < ram; i++) r += `<i class="${i < st.swaps ? 'used' : ''}"></i>`;
    } else r = `OPS <b style="color:#fff">${st.swaps}</b>`;
    r += `<span class="par">par ${G.lv.par}</span>`;
    const ramEl = $('#hud-ram');
    if (ramEl._last !== r) { ramEl.innerHTML = r; ramEl._last = r; }
    const goalsEl = $('#hud-goals');
    const parOk = st.swaps <= G.lv.par;
    const fr = st.fragTotal ? `<span class="goal ${st.frags >= st.fragTotal ? 'ok' : ''}">◆ ${st.frags}/${st.fragTotal}</span>` : '';
    const gh = `<span class="goal ${parOk ? (st.swaps ? 'ok' : '') : 'bad'}">${parOk ? '★' : '✗'} par ${st.swaps}/${G.lv.par}</span>${fr}`;
    if (goalsEl._last !== gh) { goalsEl.innerHTML = gh; goalsEl._last = gh; }
    const runBtn = $('#btn-run');
    const rb = G.paused || st.status !== 'run' ? '▶ RUN' : '⏸ PAUSE';
    if (runBtn.textContent !== rb) runBtn.textContent = rb;
    stage.classList.toggle('armed', !!G.armed);
  }

  function tlWindow() {
    const len = Math.max(G.history.length, 1);
    const span = 1800;
    const end = Math.max(span, len + 120);
    return { start: end - span, end };
  }
  function drawTimeline() {
    const w = tl.width, h = tl.height;
    tlc.clearRect(0, 0, w, h);
    if (!G.st) return;
    const f = tlWindow();
    const X = fr => (fr - f.start) / (f.end - f.start) * w;
    tlc.fillStyle = 'rgba(255,255,255,0.05)'; tlc.fillRect(0, h * 0.35, w, h * 0.3);
    const col = G.accent || '#3df2ff';
    tlc.fillStyle = R.rgba(col, 0.45); tlc.fillRect(Math.max(0, X(0)), h * 0.35, X(G.history.length - 1) - Math.max(0, X(0)), h * 0.3);
    for (const L of G.st.links) {
      const x = X(L.frame);
      tlc.fillStyle = R.TYPE_COLOR[E.TYPES[L.pa]];
      tlc.fillRect(x - 1.5, 0, 3, h);
    }
    const px = X(G.st.frame);
    tlc.fillStyle = '#fff'; tlc.fillRect(px - 1, 0, 2, h);
  }

  // ---------------- screens ----------------
  function showScreen(name) {
    G.prevScreen = G.screen;
    G.screen = name;
    ['#boot', '#title', '#select', '#datalog', '#win', '#ending'].forEach(id => $(id).classList.add('hidden'));
    if (name === 'title') $('#title').classList.remove('hidden');
    if (name === 'select') $('#select').classList.remove('hidden');
    if (name === 'datalog') $('#datalog').classList.remove('hidden');
    if (name === 'win') $('#win').classList.remove('hidden');
    if (name === 'ending') $('#ending').classList.remove('hidden');
  }

  function openSelect() {
    closeCards();
    if (G.screen === 'play') G.paused = true;
    buildSelect();
    showScreen('select');
  }
  function stars(i) { return (save.done[LEVELS[i].name] && save.done[LEVELS[i].name].stars) || 0; }
  let selAct = null;
  function actProgress(n) {
    let done = 0, st = 0, tot = 0;
    LEVELS.forEach((lv, i) => { if (lv.act !== n) return; tot++; if (save.done[LEVELS[i].name]) done++; st += stars(i); });
    return { done, st, tot };
  }
  function buildSelect() {
    const nextIdx = LEVELS.findIndex((_, i) => !save.done[LEVELS[i].name]);
    if (selAct == null) selAct = G.lv ? G.lv.act : (nextIdx >= 0 ? LEVELS[nextIdx].act : 1);
    let total = 0, frags = 0;
    LEVELS.forEach((_, i) => { total += stars(i); if (save.frags[LEVELS[i].name]) frags++; });
    // tabs
    $('#selTabs').innerHTML = ACTS.map(act => {
      const p = actProgress(act.n);
      const first = LEVELS.findIndex(l => l.act === act.n);
      const lock = !unlocked(first);
      return `<button class="tab${act.n === selAct ? ' on' : ''}${lock ? ' locked' : ''}" data-act="${act.n}" style="--c:${act.color}">
        <div class="tn">${['I', 'II', 'III', 'IV', 'V'][act.n - 1]} · ${act.title}</div>
        <div class="ts">${lock ? 'locked' : `${p.done}/${p.tot} compiled · ★ ${p.st}/${p.tot * 3}`}</div>
        <div class="tb" style="width:${(p.done / p.tot) * 100}%"></div></button>`;
    }).join('');
    $$('#selTabs .tab').forEach(t => t.onclick = () => { if (t.classList.contains('locked')) { A.sfx('error'); return; } selAct = +t.dataset.act; A.sfx('select'); buildSelect(); });
    // cells
    const act = ACTS[selAct - 1];
    let html = `<div class="act-row" style="--c:${act.color}"><div class="act-h"><span class="n" style="color:${act.color}">${act.title}</span><span class="s">${act.sub}</span><span class="heap">${act.heap}</span></div><div class="cells">`;
    LEVELS.forEach((lv, i) => {
      if (lv.act !== act.n) return;
      const s = stars(i);
      const lock = !unlocked(i);
      const tags = [lv.pointers ? 'PTR' : '', lv.wrap ? 'WRAP' : '', lv.gc ? 'GC' : '', lv.solution.some(x => x[0] > 0) ? 'TIMED' : ''].filter(Boolean);
      html += `<button class="cell${lock ? ' locked' : ''}${i === nextIdx ? ' next' : ''}${save.done[LEVELS[i].name] ? ' done' : ''}" data-i="${i}" style="--c:${act.color}">
        <img class="thumb" src="${R.thumb(lv, lv.act)}" alt="">
        ${lock ? '<span class="lockico">🔒</span>' : ''}
        <div class="meta"><div class="addr">${lv.id} <span style="color:var(--dim);font-weight:400;font-size:9px">${tags.join(' · ')}</span></div><div class="nm">${esc(lv.name)}</div>
        <div class="st">${[0, 1, 2].map(k => `<span class="${k < s ? 'on' : ''}">★</span>`).join('')}${save.frags[LEVELS[i].name] ? ' <span style="color:#ffe066;font-size:11px">◆</span>' : ''}</div></div></button>`;
    });
    html += '</div></div>';
    $('#selGrid').innerHTML = html;
    $('#sel-stats').textContent = `★ ${total}/${LEVELS.length * 3} · ◆ ${frags}/${LEVELS.length} · ${Object.keys(save.done).length}/${LEVELS.length} compiled`;
    $$('#selGrid .cell').forEach(c => c.onclick = () => {
      const i = +c.dataset.i;
      if (!unlocked(i)) { A.sfx('error'); toast('<b>LOCKED</b>', 'Compile one of the two previous levels first.'); return; }
      A.sfx('select');
      startLevel(i);
    });
  }
  function buildDatalog() {
    let html = '';
    LEVELS.forEach((lv, i) => {
      const f = lv.objects.find(o => o.kind === 'frag');
      if (!f) return;
      html += save.frags[LEVELS[i].name]
        ? `<div class="e"><b>${lv.id}</b> &nbsp;${esc(f.note)}</div>`
        : `<div class="e miss">${lv.id} &nbsp;[ ${'█'.repeat(18 + (i * 7) % 20)} ] &mdash; not recovered</div>`;
    });
    $('#logList').innerHTML = html;
  }

  function startLevel(i) {
    G.attract = false;
    showScreen('play');
    loadLevel(i);
  }

  function computeStars() {
    const st = G.st;
    let s = 1;
    const parOk = st.swaps <= G.lv.par;
    const fragOk = st.fragTotal === 0 || st.frags >= st.fragTotal;
    if (parOk) s++;
    if (fragOk) s++;
    return { s, parOk, fragOk };
  }

  function showWin() {
    if (G.winShown) return;
    G.winShown = true;
    closeCards();
    const st = G.st;
    const { s, parOk, fragOk } = computeStars();
    const prev = save.done[LEVELS[G.li].name];
    const firstClear = !prev;
    const newBest = prev && (st.swaps < prev.swaps || s > prev.stars);
    save.done[LEVELS[G.li].name] = {
      stars: Math.max(s, prev ? prev.stars : 0),
      swaps: Math.min(st.swaps, prev ? prev.swaps : 99),
      cycles: Math.min(st.frame, prev ? prev.cycles : 1e9),
    };
    if (st.frags >= st.fragTotal && st.fragTotal > 0) save.frags[LEVELS[G.li].name] = true;
    persist();
    $('#winStars').innerHTML = [0, 1, 2].map(k => `<span class="${k < s ? 'on' : ''}" style="animation-delay:${0.15 + k * 0.18}s">★</span>`).join('');
    for (let k = 0; k < s; k++) setTimeout(() => A.sfx('star', k), 180 + k * 180);
    if (newBest) setTimeout(() => toast('<b>NEW BEST</b>', G.lv.name), 400);
    const nl = LEVELS[G.li + 1];
    if (firstClear && nl && nl.act !== G.lv.act) setTimeout(() => { A.sfx('unlock'); toast(`<b>ACT ${['I', 'II', 'III', 'IV', 'V'][nl.act - 1]} UNLOCKED</b>`, ACTS[nl.act - 1].sub); }, 900);
    const best = save.done[LEVELS[G.li].name];
    $('#winStats').innerHTML = `
      <tr><td>Execution cycles</td><td>${st.frame} <span style="color:var(--dim)">(best ${best.cycles})</span></td></tr>
      <tr><td>Memory ops</td><td class="${parOk ? 'good' : 'meh'}">${st.swaps} / par ${G.lv.par} ${parOk ? '✓' : '✗'}</td></tr>
      <tr><td>Data fragment</td><td class="${fragOk ? 'good' : 'meh'}">${st.frags}/${st.fragTotal} ${fragOk ? '✓' : '✗'}</td></tr>
      ${G.rewinds ? `<tr><td>Rewinds</td><td>${G.rewinds}</td></tr>` : ''}
      ${G.usedHint ? '<tr><td>Hints</td><td>used</td></tr>' : ''}`;
    const f = G.lv.objects.find(o => o.kind === 'frag');
    const fr = $('#winFrag');
    if (f && st.frags) { fr.innerHTML = '◆ ' + esc(f.note); fr.classList.remove('hidden'); }
    else if (f) { fr.innerHTML = '◇ A data fragment is still hidden in this level.'; fr.classList.remove('hidden'); }
    else fr.classList.add('hidden');
    const last = G.li === LEVELS.length - 1;
    $('#w-next').innerHTML = last ? 'COMPILE ▸ <kbd>ENTER</kbd>' : 'NEXT ▸ <kbd>ENTER</kbd>';
    let wn = $('#winNext');
    if (!wn) { wn = document.createElement('div'); wn.id = 'winNext'; wn.className = 'win-next'; $('.panel.win').appendChild(wn); }
    wn.innerHTML = last ? 'final build ready' : `next: <b>${LEVELS[G.li + 1].id} ${esc(LEVELS[G.li + 1].name)}</b> · ${Object.keys(save.done).length}/${LEVELS.length} compiled`;
    showScreen('win');
  }

  $('#w-next').onclick = () => {
    A.sfx('select');
    if (G.li === LEVELS.length - 1) { playEnding(); return; }
    startLevel(G.li + 1);
  };
  $('#w-retry').onclick = () => { A.sfx('select'); showScreen('play'); restart(); };
  $('#w-map').onclick = () => { A.sfx('select'); G.prevScreen = 'title'; buildSelect(); showScreen('select'); };
  $$('[data-close]').forEach(b => b.onclick = () => { A.sfx('disarm'); if (G.lv && G.prevScreen === 'play') showScreen('play'); else showScreen('title'); });

  // title menu
  function refreshTitle() {
    const done = Object.keys(save.done).length;
    $('#m-continue').disabled = false;
    $('#m-continue').textContent = done ? `▶ CONTINUE  ${LEVELS[nextLevel()].id}` : '▶ ATTACH DEBUGGER';
    $('#title-progress').textContent = `${done}/${LEVELS.length} levels compiled`;
    $('#title-bar').style.width = (done / LEVELS.length * 100) + '%';
    $('#m-new').classList.toggle('hidden', !done);
  }
  function nextLevel() {
    const n = LEVELS.findIndex((_, i) => !save.done[LEVELS[i].name]);
    return n < 0 ? Math.min(save.last || 0, LEVELS.length - 1) : n;
  }
  $('#m-continue').onclick = () => { A.init(); A.sfx('select'); startLevel(nextLevel()); };
  $('#m-new').onclick = () => {
    A.init();
    if (!confirm('Wipe all progress and start a new debugging session?')) return;
    save = { v: 2, done: {}, frags: {}, muted: save.muted, last: 0, seenActs: {}, settings: save.settings }; persist();
    startLevel(0);
  };
  $('#m-map').onclick = () => { A.init(); A.sfx('select'); G.prevScreen = 'title'; buildSelect(); showScreen('select'); };
  $('#m-log').onclick = () => { A.init(); A.sfx('select'); buildDatalog(); G.prevScreen = 'title'; showScreen('datalog'); };

  // ---------------- toasts ----------------
  function toast(title, sub) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = title + (sub ? `<small>${sub}</small>` : '');
    $('#toast').appendChild(t);
    setTimeout(() => t.remove(), 3100);
  }

  // ---------------- settings ----------------
  function applySettings() {
    const o = save.settings;
    A.setVolumes(o.music / 100, o.sfx / 100);
    $('#crt').style.display = o.crt ? '' : 'none';
    R.opts.bloom = o.bloom; R.opts.shake = o.shake;
    G.traceDirty = true;
  }
  function openSettings() {
    const o = save.settings;
    $('#set-music').value = o.music; $('#set-sfx').value = o.sfx;
    $('#set-crt').checked = o.crt; $('#set-bloom').checked = o.bloom; $('#set-shake').checked = o.shake; $('#set-trace').checked = o.trace;
    $('#settings').classList.remove('hidden');
    if (G.screen === 'play') G.paused = true;
  }
  function closeSettings() { $('#settings').classList.add('hidden'); persist(); }
  [['set-music', 'music', 'value'], ['set-sfx', 'sfx', 'value'], ['set-crt', 'crt', 'checked'], ['set-bloom', 'bloom', 'checked'], ['set-shake', 'shake', 'checked'], ['set-trace', 'trace', 'checked']].forEach(([id, key, prop]) => {
    $('#' + id).addEventListener('input', e => { save.settings[key] = prop === 'value' ? +e.target.value : e.target.checked; applySettings(); persist(); if (key === 'sfx') A.sfx('select'); });
  });
  $('[data-close-settings]').onclick = () => { A.sfx('disarm'); closeSettings(); };
  $('#settings').addEventListener('mousedown', e => { if (e.target.id === 'settings') closeSettings(); });
  $('#set-reset').onclick = () => {
    if (!confirm('Erase ALL progress, stars and fragments?')) return;
    save = { v: 2, done: {}, frags: {}, muted: save.muted, last: 0, seenActs: {}, settings: save.settings }; persist();
    closeSettings(); refreshTitle(); toast('<b>PROGRESS ERASED</b>', 'fresh heap');
  };
  $('#btn-settings').onclick = () => { A.init(); A.sfx('select'); openSettings(); };
  $('#m-settings').onclick = () => { A.init(); A.sfx('select'); openSettings(); };
  applySettings();

  // ---------------- onboarding guide (first level) ----------------
  function computeGuide() {
    if (G.li !== 0 || !G.st || G.st.status !== 'ready' && G.st.status !== 'run') return null;
    const st = G.st;
    const at = id => { const e = st.byId[id]; return { x: (e.x + e.w / 2) * 32, y: e.y * 32 - 4 }; };
    if (st.swaps > 0) {
      if (G.paused) { const w = st.walker; return { x: (w.x + w.w / 2) * 32, y: w.y * 32 - 18, text: 'press SPACE to run' }; }
      return null;
    }
    if (!G.armed && !G.cardA) return Object.assign(at('spikes'), { text: 'click the spikes' });
    if (!G.armed && G.cardA) return null; // card is open: the row pulses
    if (G.armed && !G.cardB) return Object.assign(at('cloud'), { text: 'now click the cloud' });
    return null;
  }

  // ---------------- boot sequence ----------------
  const BOOT = [
    ['PIXELWORKS BIOS v1.98  (C) 1998 Pixelworks Software', 'hl'],
    ['CPU: Pentium II 266MHz   Memory Test: 65536K OK', ''],
    ['', ''],
    ['C:\\> cd GAMES\\SUNNY', ''],
    ['C:\\GAMES\\SUNNY> sunny_meadows.exe', ''],
    ['Loading SUNNY MEADOWS build 0.3.1 ...', ''],
    ['  heap 0x00400000 ............ ', ''],
    ['  ERROR: build corrupted. 50 of 51 levels failed to compile.', 'er'],
    ['  last modified: 1998-07-09 04:12 by mk', ''],
    ['', ''],
    ['Attaching debugger SWAPFILE.DBG ... OK', 'ok'],
    ['Found 1 process: PIX.exe (autonomous, uncontrollable, still walking)', ''],
    ['', ''],
    ['press any key_', 'blink'],
  ];
  let bootTimer = null, bootDone = false;
  function runBoot() {
    showScreen('boot');
    $('#boot').classList.remove('hidden');
    const out = $('#bootText');
    out.innerHTML = '';
    let i = 0;
    bootTimer = setInterval(() => {
      if (i >= BOOT.length) { clearInterval(bootTimer); return; }
      const [t, c] = BOOT[i++];
      const d = document.createElement('div');
      d.className = c; d.textContent = t || ' ';
      out.appendChild(d);
      if (t) A.sfx('type');
    }, 150);
    $('#boot').onclick = () => { A.init(); finishBoot(); };
  }
  function finishBoot() {
    if (bootDone) return;
    bootDone = true;
    clearInterval(bootTimer);
    A.init(); A.setMuted(save.muted); A.sfx('boot');
    $('#btn-mute').classList.toggle('off', save.muted);
    G.screen = 'title';
    showScreen('title');
    refreshTitle();
    startAttract();
  }

  function startAttract() {
    G.attract = true;
    loadLevel(0, { attract: true });
    G.paused = false;
    G.attractSol = LEVELS[0].solution.slice();
    G.attractDelay = 70;
  }
  function attractTick() {
    const st = G.st;
    // apply demo swap shortly after start
    if (G.attractSol.length && st.frame >= G.attractDelay) {
      const s = G.attractSol.shift();
      const [a, pa] = s[2].split('.'), [b, pb] = s[3].split('.');
      E.swap(st, a, pa, b, pb);
      const ea = st.byId[a], eb = st.byId[b];
      R.burst(...ecx(ea), R.TYPE_COLOR.bool, 14, { speed: 2.5, g: 0 });
      R.burst(...ecx(eb), R.TYPE_COLOR.bool, 14, { speed: 2.5, g: 0 });
      R.glitch = 0.4;
    }
    if (st.status === 'won' || st.status === 'dead') {
      G.attractTimer += 1 / 60;
      if (G.attractTimer > 2) { G.attractTimer = 0; startAttract(); }
    }
  }

  // ---------------- ending ----------------
  function playEnding() {
    showScreen('ending');
    const fr = Object.keys(save.frags).length;
    const totalStars = LEVELS.reduce((a, _, i) => a + stars(i), 0);
    const lines = [
      ['[GC] heap usage: 12%. no unreachable objects found.', 'ok'],
      ['$ make sunny_meadows', ''],
      ['  compiling 51/51 levels ...... OK', 'ok'],
      ['  linking ..................... OK', 'ok'],
      ['', ''],
      ['BUILD SUCCEEDED', 'big'],
      ['', ''],
      ['SUNNY MEADOWS v1.0', ''],
      ['originally due: E3, May 1998', ''],
      ['compiled: ' + new Date().toISOString().slice(0, 10), ''],
      ['', ''],
      ['PIX walked out of the last door and, for the first time in', ''],
      ['twenty-eight years, did not walk back in.', ''],
      ['', ''],
      ['// mk: if anyone ever finds this... please finish it.', 'dev'],
      ['// kj: they did, mark.', 'dev'],
      ['', ''],
      [`stars ${totalStars}/${LEVELS.length * 3}   ·   data fragments ${fr}/${LEVELS.length}`, ''],
      [fr < LEVELS.length ? 'some memories are still out there in the heap.' : 'every memory recovered. thank you, debugger.', fr < LEVELS.length ? '' : 'ok'],
    ];
    const out = $('#endText'); out.innerHTML = '';
    let i = 0;
    const tmr = setInterval(() => {
      if (i >= lines.length) { clearInterval(tmr); $('#e-done').classList.remove('hidden'); return; }
      const [t, c] = lines[i++];
      const d = document.createElement('div'); d.className = c; d.textContent = t || ' ';
      out.appendChild(d);
      if (t) A.sfx(c === 'big' ? 'win' : 'type');
    }, 420);
  }
  $('#e-done').onclick = () => { $('#e-done').classList.add('hidden'); showScreen('title'); refreshTitle(); startAttract(); };

  // ---------------- main loop ----------------
  let last = performance.now();
  function frame(now) {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    if (document.visibilityState === 'visible' && rawDt < 0.5) {
      G.perf = (G.perf || 0.016) * 0.97 + rawDt * 0.03;
      if (G.perf > 0.034 && !G.lowFx && G.time > 4) { G.lowFx = true; console.info('[swapfile] low-fx mode (bloom off)'); }
    }
    G.time += dt;
    const st = G.st;
    const playing = G.screen === 'play' || G.screen === 'win';
    if (st) {
      const sp = speed();
      A.setSlow(G.screen === 'play' && (sp < 1 || G.rewind));
      if (G.attract && G.screen !== 'play') {
        G.acc += dt * 60;
        while (G.acc >= 1) { G.acc -= 1; if (st.status === 'run' || st.status === 'ready') doStep(); attractTick(); }
        G.alpha = G.acc;
      } else if (G.screen === 'play') {
        if (G.rewind) {
          const n = sp < 1 ? 1 : 3;
          const target = Math.max(0, st.frame - n);
          if (G.history[target] && target !== st.frame) {
            E.restore(st, G.history[target]);
            for (const e of st.ents) { e.px = e.x; e.py = e.y; }
            G.history.length = target + 1;
            if (st.status !== 'won') G.winShown = false;
            if (Math.random() < 0.3) A.sfx('rewind');
            R.particles = R.particles.filter(p => p.life > 0.5);
          }
          G.alpha = 1; G.traceDirty = true;
        } else if (!G.paused && (st.status === 'run' || st.status === 'ready')) {
          G.acc += dt * 60 * sp;
          let guard = 0;
          while (G.acc >= 1 && guard++ < 6) {
            G.acc -= 1;
            doStep();
            if (st.status !== 'run') { G.acc = 0; break; }
          }
          G.alpha = st.status === 'run' ? G.acc : 1;
        } else G.alpha = 1;
        if (st.status === 'dead') G.deathT += dt;
        if (st.status === 'won' && !G.winShown) { G.wonT += dt; if (G.wonT > 1.3) showWin(); }
        if (G.paused && G.traceDirty && st.status !== 'won') computeTrace();
      }
      R.update(dt * (G.screen === 'play' && speed() < 1 ? 0.3 : 1));
      // armed line from card row to cursor
      let armLine = null;
      if (G.armed && G.mouse && G.screen === 'play') {
        const card = [G.cardA, G.cardB].find(c => c && c.dataset.id === G.armed.id);
        const row = card && card.querySelector(`.row[data-p="${G.armed.p}"]`);
        if (row) {
          const k = L2C();
          const rr = row.getBoundingClientRect(), sr = stage.getBoundingClientRect();
          const rx = (rr.left - sr.left + (rr.left - sr.left > G.mouse.x * k ? 0 : rr.width)) / k;
          const ry = (rr.top - sr.top + rr.height / 2) / k;
          armLine = { x0: rx, y0: ry, x1: G.mouse.x, y1: G.mouse.y, color: R.TYPE_COLOR[E.TYPES[G.armed.p]] };
        }
      }
      R.draw(st, {
        act: G.lv.act, time: G.time, alpha: G.alpha,
        hoverId: G.screen === 'play' && G.hover !== '__terrain' ? G.hover : null,
        selA: G.cardA ? G.cardA.dataset.id : null, selB: G.cardB ? G.cardB.dataset.id : null,
        trace: G.screen === 'play' && G.paused && !G.rewind && save.settings.trace ? G.trace : null,
        guide: G.screen === 'play' ? computeGuide() : null,
        armLine, rewinding: G.rewind && G.screen === 'play', slowmo: G.screen === 'play' && speed() < 1 && !G.paused,
        deathT: G.deathT, deathMsg: G.deathMsg, speed: speed(), showLabels: G.paused, bloom: !G.lowFx,
      });
      if (playing) {
        updateHUD();
        drawTimeline();
        if (G.cardA) { updateCardValues(G.cardA); placeCard(G.cardA, st.byId[G.cardA.dataset.id] || st.walker, 'a'); }
        if (G.cardB) { updateCardValues(G.cardB); placeCard(G.cardB, st.byId[G.cardB.dataset.id] || st.walker, 'b'); }
        syncHoverCard();
        // close cards of dead objects
        [G.cardA, G.cardB].forEach(c => { if (c && !(st.byId[c.dataset.id] || {}).alive) closeCards(); });
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------------- go ----------------
  layout();
  runBoot();
  requestAnimationFrame(frame);
  // debug handle
  window.SWAPFILE = {
    G, E, LEVELS, startLevel, save: () => save,
    step(n) { G.paused = true; for (let i = 0; i < n && (G.st.status === 'run' || G.st.status === 'ready'); i++) doStep(); return G.st.status; },
    op(kind, a, b) { const [x, px] = a.split('.'), [y, py] = b.split('.'); G.mode = kind; doOp(x, px, y, py); G.mode = 'swap'; },
    showWin,
  };
})();

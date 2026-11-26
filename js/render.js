/* SWAPFILE — renderer: neon wireframe + bloom + procedural sprites + particles */
(function () {
  'use strict';
  const E = window.Engine;
  const TS = 32, LW = 960, LH = 544;

  const PALETTE = {
    1: { a: '#3df2ff', b: '#7a5cff', bg0: '#04050f', bg1: '#0a0c24', fill: '#0a1030' },
    2: { a: '#ff4fd8', b: '#ffb84d', bg0: '#08030f', bg1: '#1a0820', fill: '#1a0a28' },
    3: { a: '#b6ff4a', b: '#3df2ff', bg0: '#030a06', bg1: '#081a14', fill: '#0a2018' },
    4: { a: '#ffc93d', b: '#ff8a3d', bg0: '#0b0802', bg1: '#1f1606', fill: '#261a08' },
    5: { a: '#ff6a3d', b: '#ff2b4a', bg0: '#0d0303', bg1: '#220808', fill: '#2a0c0c' },
  };
  const TYPE_COLOR = { float: '#3df2ff', bool: '#ff4fd8', vec: '#b6ff4a' };

  const R = {
    TS, LW, LH, PALETTE, TYPE_COLOR,
    particles: [], texts: [], shake: 0, glitch: 0, flash: 0, flashColor: '#fff',
    ripples: [], motes: [], trans: 0, opts: { bloom: true, shake: true },
  };

  let cv, ctx, glowCv, glowCtx, terrainCv, bgCv, dpr = 1, scale = 1;

  R.init = function (canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    glowCv = document.createElement('canvas'); glowCtx = glowCv.getContext('2d');
    terrainCv = document.createElement('canvas');
    bgCv = document.createElement('canvas');
  };

  R.resize = function (cssW, cssH) {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    scale = (cssW / LW) * dpr;
    glowCv.width = Math.round(cv.width / 4); glowCv.height = Math.round(cv.height / 4);
    if (R._st) R.buildStatic(R._st, R._act);
  };

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  R.rgba = hexToRgba;

  // deterministic pseudo-random
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }

  // ---------- static layers ------------------------------------------------
  R.buildStatic = function (st, act) {
    R._st = st; R._act = act;
    const P = PALETTE[act] || PALETTE[1];
    const s = Math.max(1, scale);
    // background
    bgCv.width = Math.round(LW * s); bgCv.height = Math.round(LH * 2 * s);
    const b = bgCv.getContext('2d');
    b.setTransform(s, 0, 0, s, 0, 0);
    b.fillStyle = P.bg0; b.fillRect(0, 0, LW, LH * 2);
    b.font = '9px "JetBrains Mono", Consolas, monospace';
    b.fillStyle = hexToRgba(P.a, 0.045);
    let seed = 7 + act * 101;
    for (let col = 0; col < 16; col++) {
      for (let row = 0; row < 90; row++) {
        seed++;
        const hx = Math.floor(hash(seed) * 0xffffffff).toString(16).padStart(8, '0').toUpperCase();
        if (hash(seed * 3) < 0.55) b.fillText(hx.slice(0, 2) + ' ' + hx.slice(2, 4) + ' ' + hx.slice(4, 6), col * 62 + 4, row * 12.1);
      }
    }
    // terrain
    terrainCv.width = Math.round(LW * s); terrainCv.height = Math.round(LH * s);
    const t = terrainCv.getContext('2d');
    t.setTransform(s, 0, 0, s, 0, 0);
    t.clearRect(0, 0, LW, LH);
    const solid = (c, r) => c < 0 || c >= st.W || (r >= 0 && r < st.H && st.grid[r][c] === 1);
    for (let r = 0; r < st.H; r++) for (let c = 0; c < st.W; c++) {
      if (!st.grid[r][c]) continue;
      const x = c * TS, y = r * TS;
      const g = t.createLinearGradient(0, y, 0, y + TS);
      g.addColorStop(0, P.fill); g.addColorStop(1, P.bg0);
      t.fillStyle = g; t.fillRect(x, y, TS, TS);
      // memory cell pattern
      t.fillStyle = hexToRgba(P.a, 0.05 + hash(r * 97 + c * 13) * 0.05);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (hash(r * 1000 + c * 31 + i * 7 + j) > 0.55) t.fillRect(x + 4 + i * 7, y + 4 + j * 7, 4, 4);
      if (hash(r * 31 + c * 7) > 0.92) {
        t.font = '7px Consolas, monospace'; t.fillStyle = hexToRgba(P.a, 0.25);
        t.fillText(((r * 30 + c) & 0xff).toString(16).padStart(2, '0').toUpperCase(), x + 3, y + 10);
      }
    }
    // neon edges
    t.lineCap = 'square';
    for (let r = 0; r < st.H; r++) for (let c = 0; c < st.W; c++) {
      if (!st.grid[r][c]) continue;
      const x = c * TS, y = r * TS;
      const edges = [
        [!solid(c, r - 1), x, y, x + TS, y, 2.2, 0.95],
        [!solid(c, r + 1) && r < st.H - 1, x, y + TS, x + TS, y + TS, 1.2, 0.5],
        [!solid(c - 1, r), x, y, x, y + TS, 1.4, 0.65],
        [!solid(c + 1, r), x + TS, y, x + TS, y + TS, 1.4, 0.65],
      ];
      for (const [on, x0, y0, x1, y1, lw, al] of edges) {
        if (!on) continue;
        t.strokeStyle = hexToRgba(P.a, al); t.lineWidth = lw;
        t.beginPath(); t.moveTo(x0, y0); t.lineTo(x1, y1); t.stroke();
      }
      if (!solid(c, r - 1)) { // grass-like data ticks on top surfaces
        t.fillStyle = hexToRgba(P.a, 0.35);
        for (let i = 0; i < 4; i++) if (hash(c * 5 + i + r * 77) > 0.5) t.fillRect(x + i * 8 + 2, y - 3, 1, 3);
      }
    }
  };

  // ---------- effects --------------------------------------------------------
  R.burst = function (x, y, color, n, opt) {
    opt = opt || {};
    for (let i = 0; i < n; i++) {
      const a = opt.dir != null ? opt.dir + (Math.random() - 0.5) * (opt.spread || 1.2) : Math.random() * Math.PI * 2;
      const sp = (opt.speed || 3) * (0.3 + Math.random());
      R.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: (opt.decay || 0.02) * (0.6 + Math.random() * 0.8),
        color, size: (opt.size || 3) * (0.5 + Math.random()), g: opt.g != null ? opt.g : 0.12, shape: opt.shape || 'sq', rot: Math.random() * 6,
      });
    }
  };
  R.floatText = function (x, y, text, color, big) {
    R.texts.push({ x, y, text, color, life: 1, big: !!big });
  };
  R.ripple = function (x, y, color, max) { R.ripples.push({ x, y, r: 4, max: max || 60, color, life: 1 }); };

  R.update = function (dt) {
    const k = dt * 60;
    for (const p of R.particles) {
      p.x += p.vx * k; p.y += p.vy * k; p.vy += p.g * k; p.vx *= Math.pow(0.98, k);
      p.life -= p.decay * k; p.rot += 0.1 * k;
    }
    R.particles = R.particles.filter(p => p.life > 0);
    if (R.particles.length > 900) R.particles.splice(0, R.particles.length - 900);
    for (const t of R.texts) { t.y -= 0.5 * k; t.life -= 0.012 * k; }
    R.texts = R.texts.filter(t => t.life > 0);
    for (const r of R.ripples) { r.r += (r.max - r.r) * 0.12 * k; r.life -= 0.03 * k; }
    R.ripples = R.ripples.filter(r => r.life > 0);
    if (!R.opts.shake) R.shake = 0;
    R.shake *= Math.pow(0.86, k); if (R.shake < 0.1) R.shake = 0;
    if (R.trans > 0) R.trans = Math.max(0, R.trans - dt * 1.5);
    while (R.motes.length < 46) R.motes.push({ x: Math.random() * LW, y: Math.random() * LH, v: 0.15 + Math.random() * 0.5, s: Math.random() < 0.2 ? 2 : 1, ph: Math.random() * 6 });
    for (const m of R.motes) { m.y -= m.v * k; m.x += Math.sin(m.ph + m.y * 0.02) * 0.15 * k; if (m.y < -4) { m.y = LH + 4; m.x = Math.random() * LW; } }
    R.glitch *= Math.pow(0.9, k); if (R.glitch < 0.02) R.glitch = 0;
    R.flash *= Math.pow(0.88, k);
  };

  // ---------- main draw ----------------------------------------------------
  function lerpPos(e, a) {
    if (e.px == null) return [e.x, e.y];
    const dx = e.x - e.px, dy = e.y - e.py;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) return [e.x, e.y];
    return [e.px + dx * a, e.py + dy * a];
  }
  R.entPos = lerpPos;

  R.draw = function (st, view) {
    const P = PALETTE[view.act] || PALETTE[1];
    const time = view.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
    let sx = 0, sy = 0;
    if (R.shake) { sx = (Math.random() - 0.5) * R.shake; sy = (Math.random() - 0.5) * R.shake; }
    ctx.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);

    // background
    const bgS = bgCv.width / LW;
    const scroll = (time * 6) % LH;
    ctx.drawImage(bgCv, 0, scroll * bgS, LW * bgS, LH * bgS, 0, 0, LW, LH);
    const vg = ctx.createRadialGradient(LW / 2, LH * 0.45, 50, LW / 2, LH / 2, LW * 0.75);
    vg.addColorStop(0, hexToRgba(P.bg1, 0.0)); vg.addColorStop(1, hexToRgba(P.bg1, 0.9));
    ctx.fillStyle = vg; ctx.fillRect(0, 0, LW, LH);
    // grid dots
    ctx.fillStyle = hexToRgba(P.a, 0.07);
    for (let r = 0; r <= st.H; r++) for (let c = 0; c <= st.W; c++) ctx.fillRect(c * TS - 0.5, r * TS - 0.5, 1, 1);

    // ambient data motes
    for (const m of R.motes) {
      ctx.fillStyle = hexToRgba(P.a, 0.12 + 0.12 * Math.sin(time * 2 + m.ph));
      ctx.fillRect(m.x, m.y, m.s, m.s * 2);
    }

    // terrain
    ctx.drawImage(terrainCv, 0, 0, LW, LH);
    if (st.level.wrap) drawWrapEdges(st, P, time);

    // future trace (breakpoint prediction)
    if (view.trace && view.trace.length) {
      for (let i = 0; i < view.trace.length; i++) {
        const p = view.trace[i];
        const a = 0.55 * (1 - i / view.trace.length);
        ctx.fillStyle = p.dead ? hexToRgba('#ff3d6e', a + 0.2) : p.win ? hexToRgba('#7dffb0', a + 0.2) : hexToRgba('#ffe9a8', a);
        const s = p.dead || p.win ? 6 : 3;
        ctx.fillRect(p.x * TS - s / 2, p.y * TS - s / 2, s, s);
      }
      const last = view.trace[view.trace.length - 1];
      if (last.dead) drawX(last.x * TS, last.y * TS, '#ff3d6e');
    }

    // tethers (memory traces)
    drawTethers(st, view);

    // entities
    for (const e of st.ents) {
      if (!e.alive || e.kind === 'walker') continue;
      drawEnt(st, e, view, P);
    }
    drawWalker(st, view, P);

    // hover / selection outlines
    for (const sel of [view.hoverId, view.selA, view.selB]) {
      if (!sel) continue;
      const e = st.byId[sel];
      if (!e || !e.alive) continue;
      const [ex, ey] = lerpPos(e, view.alpha);
      const isSel = sel === view.selA || sel === view.selB;
      ctx.save();
      ctx.strokeStyle = isSel ? '#ffffff' : hexToRgba('#ffffff', 0.6);
      ctx.lineWidth = isSel ? 1.5 : 1;
      ctx.setLineDash([4, 3]); ctx.lineDashOffset = -time * 20;
      ctx.strokeRect(ex * TS - 4, ey * TS - 4, e.w * TS + 8, e.h * TS + 8);
      ctx.restore();
      corners(ex * TS - 6, ey * TS - 6, e.w * TS + 12, e.h * TS + 12, isSel ? '#fff' : hexToRgba('#fff', 0.7));
    }

    // armed tether to cursor
    if (view.armLine) {
      const { x0, y0, x1, y1, color } = view.armLine;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -time * 40;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 40;
      ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x1, y1, 4, 0, 7); ctx.fill();
    }

    // particles
    for (const p of R.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      if (p.shape === 'shard') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.6, p.size); ctx.lineTo(-p.size * 0.6, p.size * 0.4); ctx.fill();
        ctx.restore();
      } else if (p.shape === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - p.life) * 2, 0, 7); ctx.stroke();
      } else ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const r of R.ripples) {
      ctx.strokeStyle = hexToRgba(r.color, Math.max(0, r.life));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke();
    }
    // floating texts
    for (const t of R.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.font = (t.big ? 'bold 16px' : 'bold 11px') + ' "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000'; ctx.fillText(t.text, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';

    // status overlays inside canvas
    if (st.status === 'dead') drawDeath(st, view);
    if (view.rewinding) drawRewind(view);
    if (view.slowmo && !view.rewinding) {
      ctx.strokeStyle = hexToRgba('#7a5cff', 0.5 + 0.2 * Math.sin(time * 6)); ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, LW - 6, LH - 6);
    }

    if (view.guide) drawGuide(view.guide, time);
    if (R.trans > 0) drawTransition(P, time);

    // bloom pass
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (view.bloom !== false && R.opts.bloom) {
      glowCtx.globalCompositeOperation = 'source-over';
      glowCtx.clearRect(0, 0, glowCv.width, glowCv.height);
      glowCtx.filter = 'blur(3px)';
      glowCtx.drawImage(cv, 0, 0, glowCv.width, glowCv.height);
      glowCtx.filter = 'none';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(glowCv, 0, 0, cv.width, cv.height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // glitch slices
    if (R.glitch > 0.05) {
      const n = Math.floor(3 + R.glitch * 10);
      for (let i = 0; i < n; i++) {
        const h = Math.random() * 30 * dpr + 4;
        const y = Math.random() * cv.height;
        const off = (Math.random() - 0.5) * 60 * R.glitch * dpr;
        ctx.drawImage(cv, 0, y, cv.width, h, off, y, cv.width, h);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 * R.glitch;
      ctx.drawImage(cv, 4 * dpr * R.glitch, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (R.flash > 0.02) {
      ctx.fillStyle = hexToRgba(R.flashColor, R.flash * 0.35);
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
  };

  function corners(x, y, w, h, color) {
    const l = 6;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x + w, y + h - l); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - l, y + h);
    ctx.moveTo(x + l, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - l);
    ctx.stroke();
  }
  function drawX(x, y, c) {
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
  }

  function centerOf(st, id, view) {
    const e = st.byId[id];
    if (!e) return [0, 0];
    const [x, y] = lerpPos(e, view.alpha);
    return [(x + e.w / 2) * TS, (y + e.h / 2) * TS];
  }

  function drawTethers(st, view) {
    const time = view.time;
    st.links.forEach((L, i) => {
      const [x0, y0] = centerOf(st, L.a, view);
      const [x1, y1] = centerOf(st, L.b, view);
      const color = TYPE_COLOR[E.TYPES[L.pa]];
      const age = st.frame - L.frame;
      const fresh = Math.max(0, 1 - Math.max(0, age) / 90);
      const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 50 - Math.abs(x1 - x0) * 0.15;
      const isPtr = L.op === 'ptr';
      ctx.save();
      ctx.strokeStyle = hexToRgba(color, 0.35 + fresh * 0.5);
      ctx.lineWidth = 1.5 + fresh * 2;
      if (isPtr) { ctx.setLineDash([3, 5]); ctx.lineDashOffset = time * 30; }
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
      ctx.restore();
      // data packets
      const n = 3;
      for (let k = 0; k < n; k++) {
        let t = ((time * 0.45 + k / n + i * 0.17) % 1);
        if (isPtr) t = 1 - t; // pointers stream from source to target
        const tt = isPtr ? 1 - t : t;
        const px = (1 - tt) * (1 - tt) * x0 + 2 * (1 - tt) * tt * mx + tt * tt * x1;
        const py = (1 - tt) * (1 - tt) * y0 + 2 * (1 - tt) * tt * my + tt * tt * y1;
        ctx.fillStyle = color;
        ctx.fillRect(px - 2, py - 2, 4, 4);
        if (!isPtr) { // swaps flow both ways
          const u = 1 - tt;
          const qx = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x1;
          const qy = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * y1;
          ctx.fillStyle = '#ffffff'; ctx.fillRect(qx - 1.5, qy - 1.5, 3, 3);
        }
      }
      if (isPtr) { // arrowhead at target
        const ang = Math.atan2(y1 - my, x1 - mx);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - Math.cos(ang - 0.4) * 10, y1 - Math.sin(ang - 0.4) * 10);
        ctx.lineTo(x1 - Math.cos(ang + 0.4) * 10, y1 - Math.sin(ang + 0.4) * 10);
        ctx.fill();
      }
      // label at apex
      if (fresh > 0 || view.showLabels) {
        ctx.font = '9px "JetBrains Mono", Consolas, monospace';
        ctx.fillStyle = hexToRgba(color, 0.5 + fresh * 0.5);
        ctx.textAlign = 'center';
        const lbl = isPtr ? `${L.b}.${L.pb} = &${L.a}.${L.pa}` : `${L.a}.${L.pa} <-> ${L.b}.${L.pb}`;
        ctx.fillText(lbl, mx, (y0 + y1) / 4 + my / 2 - 4);
        ctx.textAlign = 'left';
      }
    });
  }

  // ---------- entity drawing --------------------------------------------------
  function drawEnt(st, e, view, P) {
    const time = view.time;
    const [ex, ey] = lerpPos(e, view.alpha);
    const x = ex * TS, y = ey * TS, w = e.w * TS, h = e.h * TS;
    const g = p => E.get(st, e, p);
    const hazard = g('hazard'), solid = g('solid'), exit = g('exit'), bounce = g('bounce');
    const vel = g('velocity'), grav = g('gravity'), mass = g('mass');
    ctx.save();
    if (!solid && !['cloud', 'door', 'spike', 'laser', 'balloon', 'feather', 'frag', 'gc', 'magma'].includes(e.kind)) ctx.globalAlpha = 0.55;

    switch (e.kind) {
      case 'block': case 'lift': {
        const base = e.kind === 'lift' ? P.b : P.a;
        ctx.fillStyle = hexToRgba(base, 0.12); ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = hexToRgba(base, 0.9); ctx.lineWidth = 1.5;
        if (!solid) ctx.setLineDash([4, 4]);
        ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
        ctx.setLineDash([]);
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.strokeStyle = hexToRgba(base, 0.2); ctx.lineWidth = 1;
        for (let i = -h; i < w; i += 8) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke(); }
        ctx.restore();
        if (e.kind === 'lift') {
          ctx.fillStyle = hexToRgba(base, 0.8);
          for (let i = 0; i < w / 16; i++) ctx.fillRect(x + 6 + i * 16, y + h - 4, 6, 2);
        }
        if (mass >= 2) { ctx.fillStyle = hexToRgba(base, 0.7); [[4, 4], [w - 6, 4], [4, h - 6], [w - 6, h - 6]].forEach(([a, b]) => ctx.fillRect(x + a, y + b, 2, 2)); }
        break;
      }
      case 'crate': {
        ctx.fillStyle = 'rgba(255,184,77,0.14)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#ffb84d'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + w - 3, y + h - 3); ctx.moveTo(x + w - 3, y + 3); ctx.lineTo(x + 3, y + h - 3); ctx.stroke();
        break;
      }
      case 'anvil': {
        ctx.fillStyle = '#2a2f45';
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 4); ctx.lineTo(x + w - 2, y + 4); ctx.lineTo(x + w - 6, y + h * 0.55);
        ctx.lineTo(x + w - 4, y + h); ctx.lineTo(x + 4, y + h); ctx.lineTo(x + 6, y + h * 0.55); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#aab4ff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.font = 'bold 9px Consolas, monospace'; ctx.fillStyle = '#aab4ff'; ctx.textAlign = 'center';
        ctx.fillText(E.fmt(mass, 'float'), x + w / 2, y + h * 0.5); ctx.textAlign = 'left';
        break;
      }
      case 'spike': {
        const n = Math.max(1, Math.round(w / 10));
        const sw = w / n;
        ctx.fillStyle = hazard ? 'rgba(255,61,110,0.25)' : 'rgba(120,140,200,0.12)';
        ctx.strokeStyle = hazard ? '#ff3d6e' : 'rgba(150,170,230,0.6)';
        ctx.lineWidth = 1.5;
        if (!hazard) ctx.setLineDash([2, 3]);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (e.flip) { ctx.moveTo(x + i * sw, y); ctx.lineTo(x + i * sw + sw / 2, y + h); ctx.lineTo(x + (i + 1) * sw, y); }
          else { ctx.moveTo(x + i * sw, y + h); ctx.lineTo(x + i * sw + sw / 2, y); ctx.lineTo(x + (i + 1) * sw, y + h); }
        }
        ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        break;
      }
      case 'spring': case 'pad': {
        const live = bounce >= 0.3;
        const col = live ? '#4dff9a' : 'rgba(150,170,230,0.7)';
        const comp = live ? Math.max(0, Math.sin(time * 8)) * 2 : 0;
        // coil
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath();
        const top = (e.flip ? y + h - 4 : y + 3) + comp;
        const n = Math.max(3, Math.round(w / 6));
        for (let i = 0; i <= n; i++) {
          const px = x + 3 + (w - 6) * (i / n);
          const py = i % 2 ? y + h - 1 : top + 3;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = col; ctx.fillRect(x, top - 1, w, 3);
        if (live) { ctx.fillStyle = 'rgba(77,255,154,0.15)'; ctx.fillRect(x, y - 6 - comp, w, 6); }
        break;
      }
      case 'cloud': {
        const c = hazard ? '255,61,110' : '200,220,255';
        ctx.fillStyle = `rgba(${c},${hazard ? 0.35 : 0.16})`;
        const bob = Math.sin(time * 1.2 + e.addr) * 2;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(x + w * (0.2 + i * 0.2), y + h * 0.55 + bob + (i % 2 ? -4 : 2), h * (i % 2 ? 0.55 : 0.42), 0, 7);
          ctx.fill();
        }
        ctx.strokeStyle = `rgba(${c},0.5)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 4, y + h * 0.9 + bob); ctx.lineTo(x + w - 4, y + h * 0.9 + bob); ctx.stroke();
        if (hazard && Math.sin(time * 9 + e.addr) > 0.8) {
          ctx.strokeStyle = '#ff9ab5'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x + w / 2, y + h); ctx.lineTo(x + w / 2 - 4, y + h + 8); ctx.lineTo(x + w / 2 + 2, y + h + 8); ctx.lineTo(x + w / 2 - 2, y + h + 16); ctx.stroke();
        }
        break;
      }
      case 'door': {
        const on = exit;
        const c = on ? '#7dffe9' : 'rgba(120,130,160,0.7)';
        ctx.fillStyle = on ? 'rgba(61,242,255,0.10)' : 'rgba(80,80,100,0.15)';
        ctx.fillRect(x + 2, y, w - 4, h);
        ctx.strokeStyle = c; ctx.lineWidth = 2;
        ctx.beginPath();
        if (e.flip) { ctx.moveTo(x + 2, y); ctx.lineTo(x + 2, y + h - 6); ctx.quadraticCurveTo(x + w / 2, y + h + 4, x + w - 2, y + h - 6); ctx.lineTo(x + w - 2, y); }
        else { ctx.moveTo(x + 2, y + h); ctx.lineTo(x + 2, y + 6); ctx.quadraticCurveTo(x + w / 2, y - 4, x + w - 2, y + 6); ctx.lineTo(x + w - 2, y + h); }
        ctx.stroke();
        if (on) {
          for (let i = 0; i < 5; i++) {
            const t = (time * 0.6 + i / 5) % 1;
            ctx.fillStyle = `rgba(125,255,233,${1 - t})`;
            const py = e.flip ? y + h * t : y + h - h * t;
            ctx.fillRect(x + 5 + ((i * 7) % (w - 10)), py, 2, 2);
          }
        } else {
          ctx.font = '8px Consolas, monospace'; ctx.fillStyle = 'rgba(160,160,190,0.8)'; ctx.textAlign = 'center';
          ctx.fillText('NULL', x + w / 2, y + h / 2 + 3); ctx.textAlign = 'left';
        }
        break;
      }
      case 'glass': {
        ctx.fillStyle = 'rgba(170,220,255,0.14)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(190,235,255,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        for (let i = 0; i < w; i += 40) { ctx.beginPath(); ctx.moveTo(x + i + 6, y + h - 3); ctx.lineTo(x + i + 16, y + 3); ctx.stroke(); }
        break;
      }
      case 'balloon': {
        const bob = Math.sin(time * 2 + e.addr) * 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + w / 2, y + h * 0.8 + bob); ctx.quadraticCurveTo(x + w / 2 + 4, y + h + 4, x + w / 2 - 2, y + h + 10); ctx.stroke();
        ctx.fillStyle = 'rgba(255,90,180,0.35)'; ctx.strokeStyle = '#ff5ab4'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.42 + bob, w * 0.36, h * 0.42, 0, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x + w * 0.36, y + h * 0.22 + bob, 3, 5);
        break;
      }
      case 'feather': {
        const sw = Math.sin(time * 1.6 + e.addr) * 0.25;
        ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-0.6 + sw);
        ctx.strokeStyle = '#e9e4ff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.5); ctx.lineTo(0, h * 0.5); ctx.stroke();
        ctx.fillStyle = 'rgba(200,190,255,0.35)';
        ctx.beginPath(); ctx.moveTo(0, -h * 0.5); ctx.quadraticCurveTo(w * 0.45, -h * 0.1, 0, h * 0.35); ctx.quadraticCurveTo(-w * 0.45, -h * 0.1, 0, -h * 0.5); ctx.fill();
        ctx.restore();
        break;
      }
      case 'laser': {
        const on = hazard;
        const flick = 0.6 + 0.4 * Math.sin(time * 40 + e.addr);
        const horizontal = w > h;
        ctx.fillStyle = on ? `rgba(255,43,74,${0.5 * flick})` : 'rgba(120,130,170,0.15)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = on ? '#ff6b86' : 'rgba(150,160,200,0.5)';
        ctx.lineWidth = on ? 1.5 : 1;
        if (!on) ctx.setLineDash([3, 4]);
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); }
        else { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); }
        ctx.stroke(); ctx.setLineDash([]);
        // emitters
        ctx.fillStyle = on ? '#ff2b4a' : '#556';
        if (horizontal) { ctx.fillRect(x - 3, y - 2, 6, h + 4); ctx.fillRect(x + w - 3, y - 2, 6, h + 4); }
        else { ctx.fillRect(x - 3, y - 3, w + 6, 5); ctx.fillRect(x - 3, y + h - 2, w + 6, 5); }
        break;
      }
      case 'frag': {
        const bob = Math.sin(time * 3 + e.addr) * 3;
        const r = w * 0.55;
        ctx.save(); ctx.translate(x + w / 2, y + h / 2 + bob); ctx.rotate(time * 1.5);
        ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(255,224,102,0.25)';
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.7, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,224,102,0.9)'; ctx.font = '7px Consolas, monospace'; ctx.textAlign = 'center';
        ctx.fillText('0x' + (e.addr & 0xff).toString(16).toUpperCase(), x + w / 2, y - 4 + bob); ctx.textAlign = 'left';
        break;
      }
      case 'gc': drawGC(st, e, x, y, w, h, time); break;
      default: {
        ctx.strokeStyle = P.a; ctx.strokeRect(x, y, w, h);
      }
    }
    ctx.restore();

    // --- property-driven overlays (makes swapped state readable) ---
    const natural = E.KINDS[e.kind].props || {};
    if (hazard && !['spike', 'laser', 'gc', 'magma', 'cloud'].includes(e.kind)) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,61,110,${0.6 + 0.3 * Math.sin(time * 6)})`; ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.fillStyle = 'rgba(255,61,110,0.18)';
      for (let i = -h; i < w; i += 10) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + 5, y + h); ctx.lineTo(x + i + 5 + h, y); ctx.lineTo(x + i + h, y); ctx.fill(); }
      ctx.restore();
    }
    if (exit && e.kind !== 'door') {
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      ctx.strokeStyle = `rgba(125,255,233,${0.5 + pulse * 0.5})`; ctx.lineWidth = 2;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      for (let i = 0; i < 3; i++) {
        const t = (time * 0.7 + i / 3) % 1;
        ctx.fillStyle = `rgba(125,255,233,${1 - t})`;
        ctx.fillRect(x + ((i * 13 + 5) % Math.max(4, w - 4)), y - t * 14, 2, 2);
      }
      ctx.restore();
    }
    if (bounce >= 0.3 && e.kind !== 'spring' && e.kind !== 'pad') {
      ctx.fillStyle = `rgba(77,255,154,${0.5 + 0.3 * Math.sin(time * 8)})`;
      ctx.fillRect(x, y - 2, w, 2);
    }
    if ((vel[0] || vel[1]) && e.kind !== 'gc') {
      const ang = Math.atan2(vel[1], vel[0]);
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(ang);
      ctx.strokeStyle = 'rgba(182,255,74,0.85)'; ctx.lineWidth = 1.5;
      const off = (time * 12) % 8;
      for (let i = 0; i < 2; i++) { const px = -4 + i * 6 + off * 0.5; ctx.beginPath(); ctx.moveTo(px - 3, -4); ctx.lineTo(px + 1, 0); ctx.lineTo(px - 3, 4); ctx.stroke(); }
      ctx.restore();
    }
    if (grav && natural.gravity !== grav && e.kind !== 'gc' && view.selA !== e.id) {
      // tiny gravity glyph when gravity differs from the object's nature
      ctx.fillStyle = 'rgba(61,242,255,0.8)'; ctx.font = '8px Consolas, monospace';
      ctx.fillText(grav > 0 ? '↓' : '↑', x + w - 7, y + 8);
    }
    if (e.lockAll && view.showLocks) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + w - 6, y + 2, 4, 3);
    }
  }

  function drawGC(st, e, x, y, w, h, time) {
    const fr = Math.floor(time * 20);
    // corrupted wall
    for (let i = 0; i < 60; i++) {
      const r1 = hash(i * 7 + fr * 131), r2 = hash(i * 13 + fr * 71), r3 = hash(i * 3 + fr);
      const bx = x + (r1 - 0.3) * w * 1.6, by = y + r2 * h, bw = 4 + r3 * 18, bh = 2 + r1 * 10;
      ctx.fillStyle = r3 > 0.7 ? 'rgba(255,255,255,0.7)' : r3 > 0.35 ? 'rgba(255,106,61,0.75)' : 'rgba(255,43,74,0.6)';
      ctx.fillRect(bx, by, bw, bh);
    }
    const grad = ctx.createLinearGradient(x - 60, 0, x + w, 0);
    grad.addColorStop(0, 'rgba(255,43,74,0)'); grad.addColorStop(1, 'rgba(255,43,74,0.45)');
    ctx.fillStyle = grad; ctx.fillRect(x - 60, y, w + 60, h);
    ctx.fillStyle = 'rgba(20,0,0,0.85)'; ctx.fillRect(x, y, w, h);
    // the eye
    const ey = y + h * 0.42 + Math.sin(time * 1.3) * 10;
    ctx.fillStyle = '#ff2b4a';
    ctx.beginPath(); ctx.ellipse(x + w / 2, ey, w * 0.45, 12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(x + w / 2 - 2 + Math.sin(time * 2) * 4, ey - 5, 4, 10);
    ctx.save(); ctx.translate(x + w / 2, y + h * 0.75); ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace'; ctx.fillStyle = 'rgba(255,200,180,0.8)'; ctx.textAlign = 'center';
    ctx.fillText('GC::sweep()', 0, 4); ctx.restore();
  }

  function drawWrapEdges(st, P, time) {
    // the heap wraps: show the seams as scrolling overflow bands
    ctx.save();
    const band = (x0, y0, x1, y1, horiz) => {
      const g = horiz ? ctx.createLinearGradient(0, y0, 0, y1) : ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, hexToRgba(P.a, 0)); g.addColorStop(0.5, hexToRgba(P.a, 0.22)); g.addColorStop(1, hexToRgba(P.a, 0));
      ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    band(0, 0, LW, 10, true); band(0, LH - 10, LW, LH, true);
    ctx.font = '7px Consolas, monospace';
    ctx.fillStyle = hexToRgba(P.a, 0.55);
    const off = (time * 30) % 90;
    for (let x = -90 + off; x < LW; x += 90) { ctx.fillText('0xFFFF > 0x0000', x, 8); ctx.fillText('0xFFFF > 0x0000', LW - x - 70, LH - 3); }
    const openSides = st.grid.some(r => r[0] === 0);
    if (openSides) {
      band(0, 0, 8, LH, false); band(LW - 8, 0, LW, LH, false);
    }
    ctx.restore();
  }

  function drawGuide(g, time) {
    const bob = Math.sin(time * 6) * 5;
    const x = g.x, y = g.y - 26 + bob;
    ctx.save();
    ctx.fillStyle = '#ffe066'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + 14); ctx.lineTo(x - 9, y); ctx.lineTo(x - 3.5, y); ctx.lineTo(x - 3.5, y - 10); ctx.lineTo(x + 3.5, y - 10); ctx.lineTo(x + 3.5, y); ctx.lineTo(x + 9, y); ctx.closePath();
    ctx.stroke(); ctx.fill();
    if (g.text) {
      ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace'; ctx.textAlign = 'center';
      const tw = ctx.measureText(g.text).width + 14;
      let bx = Math.max(tw / 2 + 4, Math.min(LW - tw / 2 - 4, x));
      ctx.fillStyle = 'rgba(10,10,30,0.92)'; ctx.fillRect(bx - tw / 2, y - 34, tw, 18);
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1; ctx.strokeRect(bx - tw / 2 + 0.5, y - 33.5, tw - 1, 17);
      ctx.fillStyle = '#ffe066'; ctx.fillText(g.text, bx, y - 21);
      ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.strokeStyle = hexToRgba('#ffe066', 0.5 + 0.5 * Math.sin(time * 6)); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.x, g.y + 6, 18 + Math.sin(time * 6) * 3, 0, 7); ctx.stroke();
  }

  function drawTransition(P, time) {
    const t = R.trans; // 1 -> 0
    const cols = 40, cw = LW / cols;
    for (let i = 0; i < cols; i++) {
      const th = (i / cols) * 0.55 + hash(i * 17) * 0.25;
      if (t > th) { ctx.fillStyle = '#000'; ctx.fillRect(i * cw, 0, cw + 1, LH); }
      else if (t > th - 0.06) { ctx.fillStyle = hexToRgba(P.a, 0.8); ctx.fillRect(i * cw, 0, 2, LH); }
    }
    if (t > 0.35) {
      ctx.font = 'bold 14px "JetBrains Mono", Consolas, monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = hexToRgba(P.a, Math.min(1, (t - 0.35) * 3));
      ctx.fillText(R.transText || 'linking...', LW / 2, LH / 2);
      ctx.textAlign = 'left';
    }
  }

  // ---------- level thumbnails (memory map) ----------------------------------
  const thumbCache = {};
  R.thumb = function (lv, act) {
    if (thumbCache[lv.id]) return thumbCache[lv.id];
    const P = PALETTE[act] || PALETTE[1];
    const c = document.createElement('canvas');
    const k = 5; c.width = 30 * k; c.height = 17 * k;
    const t = c.getContext('2d');
    t.fillStyle = P.bg0; t.fillRect(0, 0, c.width, c.height);
    lv.map.forEach((row, r) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') { t.fillStyle = hexToRgba(P.a, 0.38); t.fillRect(i * k, r * k, k, k); } });
    const col = { door: '#7dffe9', spike: '#ff3d6e', laser: '#ff2b4a', spring: '#4dff9a', pad: '#8890b8', frag: '#ffe066', gc: '#ff6a3d', anvil: '#aab4ff', crate: '#ffb84d', glass: '#bfe8ff', balloon: '#ff5ab4', cloud: '#c8dcff', lift: P.b, block: P.a, feather: '#e9e4ff' };
    for (const o of lv.objects) {
      const w = o.w != null ? o.w : (o.kind === 'frag' ? 0.6 : 1);
      const h = o.h != null ? o.h : (['spike', 'spring', 'pad'].includes(o.kind) ? 0.5 : o.kind === 'frag' ? 0.6 : 1);
      const y = (h < 1 && !o.top && o.kind !== 'frag') ? o.y + (1 - h) : o.y;
      t.fillStyle = col[o.kind] || '#fff';
      t.globalAlpha = o.kind === 'cloud' ? 0.35 : 0.9;
      t.fillRect(Math.max(0, o.x) * k, Math.max(0, y) * k, Math.max(2, w * k), Math.max(2, h * k));
    }
    t.globalAlpha = 1;
    t.fillStyle = '#ffe9a8'; t.fillRect((lv.walker.x + 0.15) * k, (lv.walker.y + 0.1) * k, 0.7 * k, 0.9 * k);
    thumbCache[lv.id] = c.toDataURL();
    return thumbCache[lv.id];
  };

  // ---------- PIX ----------------------------------------------------------
  R.pix = { squash: 0, blink: 0, bubble: null, bubbleT: 0, legPhase: 0, dead: false };
  R.say = function (text, dur) { R.pix.bubble = text; R.pix.bubbleT = dur || 1.2; };
  R.squash = function (v) { R.pix.squash = v; };

  function drawWalker(st, view, P) {
    const w = st.walker;
    if (!w.alive) return;
    const time = view.time;
    const [wx, wy] = lerpPos(w, view.alpha);
    const g = E.get(st, w, 'gravity');
    const mass = E.get(st, w, 'mass');
    const flip = g < 0;
    const px = (wx + w.w / 2) * TS;
    const footY = flip ? wy * TS : (wy + w.h) * TS;
    const bw = w.w * TS, bh = w.h * TS;
    const S = R.pix;
    S.squash *= 0.85;
    if (w.grounded && st.status === 'run') S.legPhase += 0.32 * (view.speed || 1);
    const air = !w.grounded;
    let sq = S.squash;
    if (air) sq -= Math.min(0.18, Math.abs(w.vy) * 0.6);
    const sxs = 1 + sq * 0.6, sys = 1 - sq * 0.6;
    const dead = st.status === 'dead';
    const ghost = !E.get(st, w, 'solid');
    const bouncy = E.get(st, w, 'bounce') >= 0.3;
    // afterimage trail for fast / bouncy PIX
    S.trail = S.trail || [];
    if (st.status === 'run' && (bouncy || Math.abs(w.vy) > 0.3)) S.trail.push({ x: px, y: footY, life: 1 });
    S.trail = S.trail.filter(t => (t.life -= 0.06) > 0).slice(-14);
    for (const t of S.trail) {
      ctx.fillStyle = hexToRgba(bouncy ? '#4dff9a' : '#ffe9a8', t.life * 0.18);
      const ty = flip ? t.y : t.y - bh;
      ctx.fillRect(t.x - bw / 2, ty, bw, bh - 4);
    }

    ctx.save();
    if (ghost) ctx.globalAlpha = 0.38 + 0.18 * Math.sin(time * 14);
    ctx.translate(px, footY);
    if (flip) ctx.scale(1, -1);
    if (dead) { ctx.rotate(Math.sin(time * 30) * 0.1); }
    ctx.scale(sxs, sys);

    // shadow glow
    ctx.fillStyle = 'rgba(255,233,168,0.10)';
    ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.8, 4, 0, 0, 7); ctx.fill();

    // legs
    const lp = S.legPhase;
    ctx.fillStyle = mass >= 2 ? '#8b92b8' : '#e8d7a0';
    const l1 = air ? -2 : Math.sin(lp) * 2.5, l2 = air ? -2 : Math.sin(lp + Math.PI) * 2.5;
    ctx.fillRect(-bw * 0.3 + l1 * w.dir * 0.5, -5 + Math.min(0, l1), 5, 5);
    ctx.fillRect(bw * 0.06 + l2 * w.dir * 0.5, -5 + Math.min(0, l2), 5, 5);

    // body
    const bodyTop = -bh;
    const bodyCol = mass >= 2 ? '#b9c0e0' : '#ffe9a8';
    ctx.fillStyle = bodyCol;
    roundRect(-bw / 2, bodyTop, bw, bh - 4, 6); ctx.fill();
    ctx.strokeStyle = mass >= 2 ? '#e6eaff' : '#fff6d8'; ctx.lineWidth = 1; ctx.stroke();
    if (mass >= 2) { ctx.fillStyle = '#6d7496'; [[-bw / 2 + 3, bodyTop + 3], [bw / 2 - 5, bodyTop + 3], [-bw / 2 + 3, -8], [bw / 2 - 5, -8]].forEach(([a, b]) => ctx.fillRect(a, b, 2, 2)); }
    // visor
    ctx.fillStyle = '#1a1030';
    roundRect(-bw / 2 + 3, bodyTop + 5, bw - 6, 11, 4); ctx.fill();
    // eyes
    const look = w.dir * 2.5;
    S.blink -= 1 / 60;
    if (S.blink < -3 - hash(Math.floor(time)) * 2) S.blink = 0.12;
    const eh = S.blink > 0 ? 1 : 5;
    const panic = w.panic > 0;
    ctx.fillStyle = dead ? '#ff3d6e' : panic ? '#ffd23d' : '#5ff6ff';
    if (dead) {
      ctx.strokeStyle = '#ff3d6e'; ctx.lineWidth = 1.5;
      [-4, 4].forEach(o => { ctx.beginPath(); ctx.moveTo(o - 2 + look, bodyTop + 8); ctx.lineTo(o + 2 + look, bodyTop + 13); ctx.moveTo(o + 2 + look, bodyTop + 8); ctx.lineTo(o - 2 + look, bodyTop + 13); ctx.stroke(); });
    } else if (panic) {
      ctx.strokeStyle = '#ffd23d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-6 + look, bodyTop + 8); ctx.lineTo(-3 + look, bodyTop + 10.5); ctx.lineTo(-6 + look, bodyTop + 13);
      ctx.moveTo(6 + look, bodyTop + 8); ctx.lineTo(3 + look, bodyTop + 10.5); ctx.lineTo(6 + look, bodyTop + 13); ctx.stroke();
    } else {
      ctx.fillRect(-5 + look, bodyTop + 8 + (5 - eh) / 2, 3, eh);
      ctx.fillRect(2 + look, bodyTop + 8 + (5 - eh) / 2, 3, eh);
    }
    // antenna
    ctx.strokeStyle = bodyCol; ctx.lineWidth = 1.5;
    const sway = Math.sin(time * 3) * 2 - w.vx * 30;
    ctx.beginPath(); ctx.moveTo(0, bodyTop); ctx.quadraticCurveTo(sway * 0.5, bodyTop - 4, sway, bodyTop - 8); ctx.stroke();
    const blinkOn = Math.sin(time * 5) > 0;
    ctx.fillStyle = panic ? '#ff3d6e' : blinkOn ? '#5ff6ff' : '#2a6f80';
    ctx.beginPath(); ctx.arc(sway, bodyTop - 9, 2.4, 0, 7); ctx.fill();
    // cheek / chest light
    ctx.fillStyle = hexToRgba(P.a, 0.8);
    ctx.fillRect(-2, bodyTop + 19, 4, 2);
    if (ghost) { // noclip: dissolve scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      for (let yy = bodyTop + ((time * 40) % 4); yy < 0; yy += 4) ctx.fillRect(-bw / 2 - 2, yy, bw + 4, 1.5);
      ctx.strokeStyle = 'rgba(160,255,255,0.8)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(-bw / 2 - 2, bodyTop - 2, bw + 4, bh);
      ctx.setLineDash([]);
    }
    ctx.restore();

    // sweat drop when panicking
    if (panic && !dead) {
      ctx.fillStyle = '#9fe8ff';
      const dy = flip ? footY + bh + 2 : footY - bh - 2;
      ctx.beginPath(); ctx.arc(px - w.dir * 12, dy + Math.sin(time * 20) * 1.5, 2, 0, 7); ctx.fill();
    }

    // speech bubble
    if (S.bubbleT > 0 && S.bubble) {
      S.bubbleT -= 1 / 60;
      const by = flip ? footY + bh + 26 : footY - bh - 20;
      ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace';
      const tw = ctx.measureText(S.bubble).width + 12;
      const a = Math.min(1, S.bubbleT * 4);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(10,10,30,0.92)'; ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 1;
      roundRect(px - tw / 2, by - 13, tw, 18, 5); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 3, by + 5); ctx.lineTo(px, by + 9); ctx.lineTo(px + 3, by + 5); ctx.fill();
      ctx.fillStyle = '#ffe9a8'; ctx.textAlign = 'center'; ctx.fillText(S.bubble, px, by);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawDeath(st, view) {
    const t = view.deathT || 0;
    ctx.fillStyle = `rgba(40,0,10,${Math.min(0.55, t * 1.5)})`;
    ctx.fillRect(0, 0, LW, LH);
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px "Press Start 2P", "JetBrains Mono", Consolas, monospace';
    const jx = (Math.random() - 0.5) * 4 * Math.max(0, 1 - t);
    ctx.fillStyle = 'rgba(61,242,255,0.7)'; ctx.fillText('SEGFAULT', LW / 2 - 3 + jx, LH * 0.42);
    ctx.fillStyle = 'rgba(255,43,74,0.85)'; ctx.fillText('SEGFAULT', LW / 2 + 3 - jx, LH * 0.42);
    ctx.fillStyle = '#fff'; ctx.fillText('SEGFAULT', LW / 2 + jx * 0.3, LH * 0.42);
    ctx.font = '14px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = '#ffb3c1';
    ctx.fillText(view.deathMsg || 'core dumped', LW / 2, LH * 0.42 + 36);
    if (t > 0.6) {
      ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(view.time * 5)})`;
      ctx.font = '13px "JetBrains Mono", Consolas, monospace';
      ctx.fillText('hold [Z] to rewind     [R] restart', LW / 2, LH * 0.42 + 70);
    }
    ctx.textAlign = 'left';
  }

  function drawRewind(view) {
    ctx.fillStyle = 'rgba(122,92,255,0.10)'; ctx.fillRect(0, 0, LW, LH);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let y = (view.time * 400) % 12; y < LH; y += 12) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(LW, y); ctx.stroke(); }
    ctx.font = 'bold 22px "Press Start 2P", Consolas, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('◀◀', 24, 44);
  }

  window.Render = R;
})();

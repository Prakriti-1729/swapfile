/* SWAPFILE — deterministic simulation core.
 * Pure logic: no DOM, no rendering. Runs in the browser and in Node (tools/verify.js).
 * Units: tiles. Fixed timestep: 60 steps per second.
 */
(function (root) {
  'use strict';

  // ---- Property schema (the "components") -------------------------------
  const TYPES = {
    gravity: 'float', bounce: 'float', mass: 'float',
    velocity: 'vec',
    solid: 'bool', hazard: 'bool', exit: 'bool',
  };
  const PROP_ORDER = ['gravity', 'bounce', 'mass', 'velocity', 'solid', 'hazard', 'exit'];
  const PROP_LABEL = {
    gravity: 'Gravity_Scale', bounce: 'Restitution', mass: 'Mass', velocity: 'Velocity',
    solid: 'Is_Solid', hazard: 'Is_Hazard', exit: 'Is_Exit',
  };

  const C = {
    G: 0.014,        // gravity accel per frame^2 (scale 1)
    MAXV: 0.42,      // terminal fall speed
    MAXUP: 0.62,     // max launch speed
    WALK: 0.055,     // walker speed (tiles / frame)
    JUMPV: 0.215,
    JUMPX: 0.1,
    BOUNCEK: 0.3,    // spring launch = bounce * BOUNCEK
    PANIC: 1.7,
    SIGHT: 3,
    STEP: 0.52,
    DWELL: 100,       // frames a mover waits after reversing
  };
  const EPS = 1e-6;

  const BASE = { gravity: 0, bounce: 0, mass: 1, velocity: [0, 0], solid: true, hazard: false, exit: false };

  const KINDS = {
    walker:  { w: 0.7, h: 0.9, schema: ['gravity', 'bounce', 'mass', 'solid'], props: { gravity: 1, mass: 1 }, cls: 'BlindWalker' },
    block:   { cls: 'StaticMesh', props: { mass: 2 } },
    crate:   { cls: 'PhysicsCrate', props: { gravity: 1, mass: 0.5 } },
    spike:   { cls: 'SpikeTrap', h: 0.5, props: { hazard: true, solid: false } },
    spring:  { cls: 'SpringPad', h: 0.5, props: { bounce: 1.5 } },
    pad:     { cls: 'FloorPad', h: 0.5, props: { } },
    cloud:   { cls: 'BgCloud', props: { solid: false, mass: 0.2 } },
    door:    { cls: 'ExitDoor', props: { exit: true, solid: false, mass: 3 } },
    glass:   { cls: 'GlassPane', props: { mass: 0.5 }, fragile: true },
    balloon: { cls: 'Balloon', props: { gravity: -1, solid: false, mass: 0.1 } },
    feather: { cls: 'Feather', props: { gravity: 0.1, solid: false, mass: 0.05 } },
    anvil:   { cls: 'Anvil', props: { gravity: 1, mass: 5 } },
    lift:    { cls: 'MovingPlatform', props: { mass: 3 } },
    laser:   { cls: 'LaserGrid', props: { hazard: true, solid: false, mass: 0 } },
    magma:   { cls: 'MagmaPool', props: { hazard: true, solid: false, mass: 4 } },
    frag:    { cls: 'DataFragment', w: 0.6, h: 0.6, props: { solid: false, mass: 0 }, pickup: true },
    gc:      { cls: 'GarbageCollector', props: { hazard: true, solid: false, mass: 999, velocity: [1, 0] }, phase: true },
    sign:    { cls: 'DevComment', props: { solid: false, mass: 0 } },
  };

  // ---- helpers -----------------------------------------------------------
  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw - EPS && ax + aw > bx + EPS && ay < by + bh - EPS && ay + ah > by + EPS;
  }
  function get(st, e, p) { return st.cells[e.ref[p]]; }
  function set(st, e, p, v) { st.cells[e.ref[p]] = v; }
  function isSolid(st, e) { return !e.phase && !e.pickup && !!get(st, e, 'solid'); }
  function cloneVal(v) { return Array.isArray(v) ? [v[0], v[1]] : v; }

  // terrain lookup; OVERFLOW levels wrap horizontally instead of having solid edges
  function tsolid(st, c, r) {
    if (c < 0 || c >= st.W) { if (!st.level.wrap) return true; c = ((c % st.W) + st.W) % st.W; }
    if (r < 0 || r >= st.H) return false;
    return st.grid[r][c] === 1;
  }

  function terrainBoxes(st, x, y, w, h, out) {
    const c0 = Math.floor(x + EPS), c1 = Math.floor(x + w - EPS);
    const r0 = Math.floor(y + EPS), r1 = Math.floor(y + h - EPS);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tsolid(st, c, r)) out.push({ x: c, y: r, w: 1, h: 1, terrain: true });
      }
    }
    return out;
  }

  function blockers(st, e, x, y, ignore) {
    const out = [];
    if (e.phase) return out;
    terrainBoxes(st, x, y, e.w, e.h, out);
    const eSolid = !!get(st, e, 'solid');
    if (!eSolid || e.pickup) return out;
    for (const o of st.ents) {
      if (o === e || !o.alive || (ignore && ignore.has(o))) continue;
      if (!isSolid(st, o)) continue;
      if (overlap(x, y, e.w, e.h, o.x, o.y, o.w, o.h)) out.push(o);
    }
    return out;
  }

  // Move along one axis with collision. Returns array of blockers hit, or null.
  function moveBy(st, e, dx, dy, ignore) {
    if (!dx && !dy) return null;
    const nx = e.x + dx, ny = e.y + dy;
    const bl = blockers(st, e, nx, ny, ignore);
    const hits = bl.filter(b => !overlap(e.x, e.y, e.w, e.h, b.x, b.y, b.w, b.h));
    if (!hits.length) { e.x = nx; e.y = ny; return null; }
    if (dx > 0) { let m = Infinity; for (const b of hits) m = Math.min(m, b.x); e.x = Math.max(e.x, m - e.w); }
    else if (dx < 0) { let m = -Infinity; for (const b of hits) m = Math.max(m, b.x + b.w); e.x = Math.min(e.x, m); }
    if (dy > 0) { let m = Infinity; for (const b of hits) m = Math.min(m, b.y); e.y = Math.max(e.y, m - e.h); }
    else if (dy < 0) { let m = -Infinity; for (const b of hits) m = Math.max(m, b.y + b.h); e.y = Math.min(e.y, m); }
    return hits;
  }

  function gdirOf(st, e) { const g = get(st, e, 'gravity'); return g > 0 ? 1 : g < 0 ? -1 : 0; }

  // Entities resting on e (on top for normal gravity, hanging below for inverted)
  function ridersOf(st, e) {
    const out = [];
    for (const o of st.ents) {
      if (o === e || !o.alive || o.phase || o.pickup) continue;
      if (o.x >= e.x + e.w - EPS || o.x + o.w <= e.x + EPS) continue;
      const og = get(st, o, 'gravity');
      if (o.kind === 'walker' && o.vy * (og < 0 ? -1 : 1) < -0.01) continue; // launching away
      if (og >= 0 && Math.abs(o.y + o.h - e.y) < 0.03) out.push({ o, top: true });
      else if (og < 0 && Math.abs(o.y - (e.y + e.h)) < 0.03) out.push({ o, top: false });
    }
    return out;
  }

  function carryMove(st, e, dx, dy, depth) {
    depth = depth || 0;
    const riders = depth < 4 && isSolid(st, e) ? ridersOf(st, e) : [];
    const first = [], after = [];
    for (const r of riders) {
      // riders positioned in the direction of vertical motion must move first
      if ((dy < 0 && r.top) || (dy > 0 && !r.top)) first.push(r.o); else after.push(r.o);
    }
    for (const o of first) carryMove(st, o, dx, dy, depth + 1);
    const ox = e.x, oy = e.y;
    const hit = moveBy(st, e, dx, dy);
    const adx = e.x - ox, ady = e.y - oy;
    for (const o of after) if (adx || ady) carryMove(st, o, adx, ady, depth + 1);
    return hit;
  }

  function pointSolid(st, self, px, py) {
    const c = Math.floor(px), r = Math.floor(py);
    if (tsolid(st, c, r)) return true;
    if (self && self.kind === 'walker' && !get(st, self, 'solid')) return false;
    for (const o of st.ents) {
      if (o === self || !o.alive || !isSolid(st, o)) continue;
      if (px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h) return o;
    }
    return false;
  }
  function hazardInBox(st, self, x, y, w, h) {
    for (const o of st.ents) {
      if (o === self || !o.alive || o.pickup) continue;
      if (!get(st, o, 'hazard')) continue;
      if (overlap(x, y, w, h, o.x, o.y, o.w, o.h)) return o;
    }
    return null;
  }

  // ---- state construction -------------------------------------------------
  function load(level) {
    const H = level.map.length, W = level.map[0].length;
    const grid = level.map.map(row => Array.from(row).map(ch => (ch === '#' ? 1 : 0)));
    const st = {
      W, H, grid, ents: [], cells: [], byId: {}, frame: 0, status: 'ready', swaps: 0,
      links: [], frags: 0, fragTotal: 0, death: null, level, events: [], gcFreed: false,
    };
    const wl = level.walker;
    addEnt(st, Object.assign({ id: 'pix', kind: 'walker', x: wl.x + 0.15, y: wl.y + 0.1 }, wl, { x: wl.x + 0.15, y: wl.y + 0.1 }));
    const w = st.ents[0];
    st.walker = w;
    w.dir = wl.dir || 1; w.vx = 0; w.vy = 0; w.panic = 0; w.grounded = false; w.air = 0;
    if (get(st, w, 'gravity') < 0) w.y = wl.y; // hanging start
    for (const o of level.objects || []) addEnt(st, o);
    st.fragTotal = st.ents.filter(e => e.pickup).length;
    return st;
  }

  let addrSeed = 0x40;
  function addEnt(st, d) {
    const k = KINDS[d.kind];
    if (!k) throw new Error('Unknown kind ' + d.kind);
    const w = d.w != null ? d.w : (k.w != null ? k.w : 1);
    const h = d.h != null ? d.h : (k.h != null ? k.h : 1);
    let y = d.y;
    // half-height kinds sit on the bottom of their tile unless explicitly flipped
    if (d.kind !== 'walker' && h < 1 && d.y === Math.floor(d.y) && !d.top) y = d.y + (1 - h);
    let x = d.x;
    if (k.pickup && d.x === Math.floor(d.x)) { x = d.x + (1 - w) / 2; y = d.y + (1 - h) / 2; }
    const e = {
      id: d.id || (d.kind + '_' + st.ents.length), kind: d.kind, cls: k.cls,
      x, y, w, h, ref: {}, lock: {}, alive: true, fv: 0, dwell: 0,
      schema: k.schema || PROP_ORDER, fragile: !!k.fragile, pickup: !!k.pickup, phase: !!k.phase,
      label: d.label || null, note: d.note || null, addr: d.addr || (0x1000 + (st.ents.length * 0x24) + (addrSeed++ & 0xf) * 0x100),
      flip: !!d.flip, bindGc: d.bind === 'gc',
    };
    const props = Object.assign({}, BASE, k.props, d.props || {});
    for (const p of PROP_ORDER) {
      st.cells.push(cloneVal(props[p]));
      e.ref[p] = st.cells.length - 1;
    }
    const lk = d.lock === undefined ? (d.kind === 'walker' || k.pickup || k.phase ? '*' : null) : d.lock;
    if (lk === '*') for (const p of PROP_ORDER) e.lock[p] = true;
    else if (Array.isArray(lk)) for (const p of lk) e.lock[p] = true;
    if (d.unlock) for (const p of d.unlock) delete e.lock[p];
    if (d.open) { // whitelist: only these props are writable
      for (const p of PROP_ORDER) e.lock[p] = true;
      for (const p of d.open) delete e.lock[p];
    }
    st.ents.push(e);
    st.byId[e.id] = e;
    return e;
  }

  // ---- swapping / pointers ------------------------------------------------
  function checkOp(st, op, a, pa, b, pb) {
    if (!a || !b || !a.alive || !b.alive) return 'NULL_REFERENCE';
    if (a.schema.indexOf(pa) < 0 || b.schema.indexOf(pb) < 0) return 'NO_SUCH_FIELD';
    if (TYPES[pa] !== TYPES[pb]) return 'TYPE_MISMATCH';
    if (a === b && pa === pb) return 'SELF_ASSIGN';
    if (op === 'swap') {
      if (a.lock[pa] || b.lock[pb]) return 'CONST_VIOLATION';
      if (a.ref[pa] === b.ref[pb]) return 'SAME_ADDRESS';
    } else if (op === 'ptr') {
      // a = source (may be const), b = target (must be writable)
      if (b.lock[pb]) return 'CONST_VIOLATION';
      if (a.ref[pa] === b.ref[pb]) return 'SAME_ADDRESS';
    }
    const lv = st.level;
    if (op === 'ptr' && !lv.pointers) return 'POINTERS_DISABLED';
    if (lv.ram != null && st.swaps >= lv.ram) return 'OUT_OF_MEMORY';
    return null;
  }

  function swap(st, aId, pa, bId, pb) {
    const a = st.byId[aId], b = st.byId[bId];
    const err = checkOp(st, 'swap', a, pa, b, pb);
    if (err) return err;
    const ca = a.ref[pa], cb = b.ref[pb];
    const t = st.cells[ca]; st.cells[ca] = st.cells[cb]; st.cells[cb] = t;
    st.swaps++;
    st.links.push({ op: 'swap', a: aId, pa, b: bId, pb, frame: st.frame });
    if (st.status === 'won' || st.status === 'dead') {} // ignored
    return null;
  }

  function pointer(st, srcId, ps, dstId, pd) {
    const a = st.byId[srcId], b = st.byId[dstId];
    const err = checkOp(st, 'ptr', a, ps, b, pd);
    if (err) return err;
    b.ref[pd] = a.ref[ps];
    st.swaps++;
    st.links.push({ op: 'ptr', a: srcId, pa: ps, b: dstId, pb: pd, frame: st.frame });
    return null;
  }

  // ---- simulation ---------------------------------------------------------
  function kill(st, reason, by) {
    if (st.status !== 'run') return;
    st.status = 'dead';
    st.death = { reason, by: by ? by.id : null, frame: st.frame };
    st.events.push({ type: 'die', reason, by });
  }

  function breakEnt(st, o) {
    o.alive = false;
    st.events.push({ type: 'shatter', e: o });
  }

  function step(st) {
    st.events = [];
    if (st.status === 'ready') st.status = 'run';
    if (st.status !== 'run') return st.events;
    stepObjects(st);
    if (st.status === 'run') stepWalker(st);
    if (st.status === 'run') checkWalker(st);
    st.frame++;
    return st.events;
  }

  function stepObjects(st) {
    const ev = st.events;
    for (const e of st.ents) {
      if (!e.alive || e.kind === 'walker') continue;
      if (e.phase) { stepPhase(st, e); continue; }
      if (e.pickup) continue;
      const v = get(st, e, 'velocity');
      if (v[0] || v[1]) {
        if (e.dwell > 0) e.dwell--;
        else {
          if (v[0]) {
            const hit = carryMove(st, e, v[0] / 60, 0);
            if (hit) { const cv = get(st, e, 'velocity'); set(st, e, 'velocity', [-cv[0], cv[1]]); e.dwell = C.DWELL; ev.push({ type: 'reverse', e }); }
          }
          const v2 = get(st, e, 'velocity');
          if (v2[1] && e.dwell === 0) {
            const hit = carryMove(st, e, 0, v2[1] / 60);
            if (hit) { const cv = get(st, e, 'velocity'); set(st, e, 'velocity', [cv[0], -cv[1]]); e.dwell = C.DWELL; ev.push({ type: 'reverse', e }); }
          }
        }
      } else e.dwell = 0;
      const g = get(st, e, 'gravity');
      if (g) {
        e.fv += C.G * g;
        if (e.fv > C.MAXV) e.fv = C.MAXV;
        if (e.fv < -C.MAXV) e.fv = -C.MAXV;
        const impact = Math.abs(e.fv);
        const hit = carryMove(st, e, 0, e.fv);
        if (hit) {
          let broke = false;
          for (const b of hit) {
            if (b.kind === 'walker' && impact > 0.15 && isSolid(st, e) && get(st, e, 'mass') >= 1) kill(st, 'crush', e);
            if (b.fragile && get(st, e, 'mass') >= 2 && impact > 0.08) { breakEnt(st, b); broke = true; }
          }
          if (impact > 0.12) ev.push({ type: 'thud', e, impact });
          if (!broke) e.fv = 0;
        }
        if (e.y > st.H + 3 || e.y + e.h < -4) {
          e.alive = false;
          ev.push({ type: 'oob', e });
        }
      } else e.fv = 0;
    }
  }

  function stepPhase(st, e) {
    const v = get(st, e, 'velocity');
    e.x += v[0] / 60; e.y += v[1] / 60;
    const g = get(st, e, 'gravity');
    if (g) { e.fv += C.G * g * 0.5; e.y += e.fv; }
    // the collector deletes whatever it touches
    for (const o of st.ents) {
      if (o === e || !o.alive || o.kind === 'walker' || o.phase) continue;
      if (o.lock.solid && o.lock.gravity && o.kind === 'door') continue; // kernel-protected
      if (overlap(e.x, e.y, e.w, e.h, o.x, o.y, o.w, o.h)) { o.alive = false; st.events.push({ type: 'collected', e: o }); }
    }
    if (e.y > st.H + 2 || e.y + e.h < -2 || e.x > st.W + 2 || e.x + e.w < -3) {
      e.alive = false;
      if (e.kind === 'gc') {
        st.gcFreed = true; st.events.push({ type: 'gcfreed', e });
        for (const o of st.ents) if (o.bindGc && o.alive) { o.alive = false; st.events.push({ type: 'shatter', e: o }); }
      }
    }
  }

  function supportList(st, w, gd) {
    if (!gd) return [];
    return blockers(st, w, w.x, w.y + gd * 0.03).filter(b => !overlap(w.x, w.y, w.w, w.h, b.x, b.y, b.w, b.h));
  }

  function seesHazard(st, w) {
    const front = w.dir > 0 ? w.x + w.w : w.x;
    const y0 = w.y + 0.1, y1 = w.y + w.h - 0.1, my = w.y + w.h / 2;
    let best = null, bestD = Infinity;
    for (const o of st.ents) {
      if (o === w || !o.alive || o.pickup || !get(st, o, 'hazard')) continue;
      if (o.y >= y1 || o.y + o.h <= y0) continue;
      const d = w.dir > 0 ? o.x - front : front - (o.x + o.w);
      if (d < -0.3 || d > C.SIGHT) continue;
      // line of sight (terrain / solid non-hazard objects block it)
      let blocked = false;
      for (let s = 0.1; s < d; s += 0.2) {
        const px = front + w.dir * s;
        const hit = pointSolid(st, w, px, my);
        if (hit === true || (hit && hit !== o && !get(st, hit, 'hazard'))) { blocked = true; break; }
      }
      if (!blocked && d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  function ledgeDecision(st, w, gd) {
    const front = w.dir > 0 ? w.x + w.w : w.x;
    const feet = gd > 0 ? w.y + w.h : w.y;
    if (pointSolid(st, w, front + w.dir * 0.06, feet + gd * 0.08)) return { act: 'walk' };
    // drop down?
    const px = front + w.dir * 0.36;
    for (let d = 0.25; d <= 3.3; d += 0.25) {
      const py = feet + gd * d;
      if (py < -1 || py > st.H + 1) break;
      if (pointSolid(st, w, px, py)) {
        const top = Math.min(feet, py), hgt = Math.abs(py - feet);
        const hz = hazardInBox(st, w, px - 0.35, top, 0.7, hgt + 0.1);
        if (hz) return { act: 'turn', why: 'hazard_below', o: hz };
        return { act: 'walk' };
      }
    }
    // gap jump?
    for (let gx = 0.3; gx <= 2.35; gx += 0.15) {
      if (pointSolid(st, w, front + w.dir * gx, feet + gd * 0.08)) return { act: 'jump', gap: gx };
    }
    return { act: 'turn', why: 'ledge' };
  }

  function stepWalker(st) {
    const w = st.walker, ev = st.events;
    const g = get(st, w, 'gravity');
    const gd = g > 0 ? 1 : g < 0 ? -1 : 0;
    const sup = supportList(st, w, gd);
    const grounded = gd !== 0 && sup.length > 0 && w.vy * gd >= -1e-9;
    let launched = false;
    if (grounded) {
      w.vy = 0; w.air = 0;
      // spring surfaces launch the walker
      let b = 0, src = null;
      for (const s of sup) if (!s.terrain) { const bb = get(st, s, 'bounce'); if (bb > b) { b = bb; src = s; } }
      if (b >= 0.3) {
        w.vy = -gd * Math.min(b * C.BOUNCEK, C.MAXUP);
        w.vx = w.dir * C.WALK;
        launched = true;
        ev.push({ type: 'bounce', e: src, power: b });
      }
    }
    w.grounded = grounded && !launched;

    if (w.grounded) {
      let speed = C.WALK;
      if (w.panic > 0) { w.panic--; speed *= C.PANIC; }
      if (w.panic <= 0) {
        const hz = seesHazard(st, w);
        if (hz) { w.dir *= -1; w.panic = 45; ev.push({ type: 'panic', e: hz }); speed = C.WALK * C.PANIC; }
      }
      const dec = ledgeDecision(st, w, gd);
      if (dec.act === 'jump' && sup.some(s => !s.terrain && (s.fv || get(st, s, 'velocity')[0] || get(st, s, 'velocity')[1]))) { dec.act = 'turn'; dec.why = 'moving_floor'; }
      if (dec.act === 'turn') { w.dir *= -1; ev.push({ type: 'turn', why: dec.why, e: dec.o }); }
      if (dec.act === 'jump') { w.vy = -gd * C.JUMPV; w.vx = w.dir * C.JUMPX; w.grounded = false; ev.push({ type: 'jump' }); }
      else w.vx = w.dir * speed;
    } else if (!launched) {
      w.air++;
      if (gd !== 0) {
        w.vy += C.G * g;
        const mf = Math.abs(g) >= 3 ? 0.5 * Math.abs(g) : C.MAXV; // OVERFLOW: past 3.0 the clamp breaks
        if (w.vy * gd > mf) w.vy = gd * mf;
      } else {
        w.vy *= 0.92;
        w.vx = w.dir * C.WALK;
      }
    }

    // --- horizontal
    if (w.vx) {
      const ox = w.x;
      let hits = moveBy(st, w, w.vx, 0);
      if (hits) {
        let ok = false;
        const rem = w.vx - (w.x - ox);
        const wm = get(st, w, 'mass');
        const pushable = hits.every(h => !h.terrain && get(st, h, 'gravity') !== 0 && get(st, h, 'mass') < wm);
        if (pushable && w.grounded) {
          for (const h of hits) carryMove(st, h, rem, 0);
          if (!moveBy(st, w, rem, 0)) { ok = true; ev.push({ type: 'push', e: hits[0] }); }
        }
        if (!ok && w.grounded && gd !== 0) {
          const sx = w.x, sy = w.y;
          if (!moveBy(st, w, 0, -gd * C.STEP) && !moveBy(st, w, rem, 0)) {
            moveBy(st, w, 0, gd * C.STEP);
            ok = true; ev.push({ type: 'step' });
          } else { w.x = sx; w.y = sy; }
        }
        if (!ok) {
          w.dir *= -1;
          w.vx = w.grounded ? 0 : w.dir * C.WALK * 0.5; // airborne: rebound off the wall
          const wh = hits.find(h => !h.terrain);
          ev.push({ type: 'turn', why: 'wall', e: wh || null });
        }
      }
    }

    // --- vertical
    if (w.vy) {
      const impact = Math.abs(w.vy);
      const mvY = w.vy;
      let hits = moveBy(st, w, 0, mvY);
      if (hits) {
        const withG = gd !== 0 && Math.sign(mvY) === gd;
        let broke = false;
        if (withG && get(st, w, 'mass') >= 2 && impact > 0.08) {
          for (const h of hits) if (h.fragile) { breakEnt(st, h); broke = true; }
        }
        if (!broke) {
          if (withG) {
            const wb = get(st, w, 'bounce');
            if (wb >= 0.3 && impact > 0.09) { w.vy = -w.vy * Math.min(wb, 1.4); w.vx = w.dir * C.WALK; ev.push({ type: 'bounce', e: w, power: wb }); }
            else { w.vy = 0; if (impact > 0.05) ev.push({ type: 'land', impact }); }
          } else {
            w.vy = 0; ev.push({ type: 'bonk' });
          }
        }
      }
    }
  }

  function checkWalker(st) {
    const w = st.walker;
    const ex = 0.04;
    for (const o of st.ents) {
      if (o === w || !o.alive) continue;
      if (o.pickup) {
        if (overlap(w.x, w.y, w.w, w.h, o.x, o.y, o.w, o.h)) { o.alive = false; st.frags++; st.events.push({ type: 'frag', e: o }); }
        continue;
      }
      if (get(st, o, 'exit') && overlap(w.x - ex, w.y - ex, w.w + ex * 2, w.h + ex * 2, o.x, o.y, o.w, o.h)) {
        st.status = 'won'; st.events.push({ type: 'win', e: o }); return;
      }
    }
    for (const o of st.ents) {
      if (o === w || !o.alive || o.pickup) continue;
      if (!get(st, o, 'hazard')) continue;
      const m = isSolid(st, o) ? -0.04 : 0.12;
      if (overlap(w.x + m, w.y + m, w.w - m * 2, w.h - m * 2, o.x, o.y, o.w, o.h)) { kill(st, o.phase ? 'collected' : 'hazard', o); return; }
    }
    if (st.level.wrap) {
      // integer overflow: the heap wraps around
      let wrapped = false;
      if (w.y > st.H + 0.2) { w.y = -w.h - 0.1; wrapped = true; }
      else if (w.y + w.h < -0.2) { w.y = st.H + 0.1; wrapped = true; }
      if (w.x + w.w / 2 >= st.W) { w.x -= st.W; wrapped = true; }
      else if (w.x + w.w / 2 < 0) { w.x += st.W; wrapped = true; }
      if (wrapped) { st.wraps = (st.wraps || 0) + 1; st.events.push({ type: 'wrap' }); if (st.wraps > 60) { kill(st, 'loop'); return; } }
    } else {
      if (w.y > st.H + 0.5) { kill(st, 'void'); return; }
      if (w.y + w.h < -1.5) { kill(st, 'overflow'); return; }
    }
    // embedded in solid memory (crushed / swapped solid onto us)
    const sh = 0.08;
    const tmp = { x: w.x + sh, y: w.y + sh, w: w.w - sh * 2, h: w.h - sh * 2, kind: 'walker', ref: w.ref, phase: false };
    const bl = blockers(st, tmp, tmp.x, tmp.y, new Set([w]));
    if (bl.length) kill(st, 'crush', bl.find(b => !b.terrain) || null);
  }

  // ---- snapshots (rewind) ---------------------------------------------------
  function snapshot(st) {
    const ents = new Array(st.ents.length);
    for (let i = 0; i < st.ents.length; i++) {
      const e = st.ents[i];
      ents[i] = [e.x, e.y, e.fv, e.alive, e.dwell, Object.assign({}, e.ref)];
    }
    const w = st.walker;
    return {
      frame: st.frame, status: st.status, swaps: st.swaps, frags: st.frags, death: st.death, gcFreed: st.gcFreed, wraps: st.wraps || 0,
      cells: st.cells.slice(), ents, links: st.links.slice(),
      w: [w.vx, w.vy, w.dir, w.panic, w.grounded, w.air],
    };
  }
  function restore(st, s) {
    st.frame = s.frame; st.status = s.status; st.swaps = s.swaps; st.frags = s.frags; st.death = s.death; st.gcFreed = s.gcFreed; st.wraps = s.wraps || 0;
    st.cells = s.cells.slice(); st.links = s.links.slice();
    for (let i = 0; i < st.ents.length; i++) {
      const e = st.ents[i], d = s.ents[i];
      e.x = d[0]; e.y = d[1]; e.fv = d[2]; e.alive = d[3]; e.dwell = d[4]; e.ref = Object.assign({}, d[5]);
    }
    const w = st.walker;
    [w.vx, w.vy, w.dir, w.panic, w.grounded, w.air] = s.w;
  }

  function fmt(v, type) {
    if (type === 'bool') return v ? 'TRUE' : 'FALSE';
    if (type === 'vec') return '(' + fmtNum(v[0]) + ', ' + fmtNum(v[1]) + ')';
    return fmtNum(v);
  }
  function fmtNum(n) {
    if (Number.isInteger(n)) return n.toFixed(1);
    return (Math.round(n * 100) / 100).toString();
  }

  const Engine = {
    TYPES, PROP_ORDER, PROP_LABEL, KINDS, C,
    load, step, swap, pointer, checkOp, snapshot, restore, get, isSolid, fmt, overlap, seesHazard,
  };
  root.Engine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);

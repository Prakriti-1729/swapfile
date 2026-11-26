// Brute-force solver: node tools/solve.js <levelIndex|all> [--depth N] [--frames F]
// Tries every legal combination of ops applied at frame 0 (swaps, plus pointers if the level allows).
// Reports the minimum number of ops that wins, and how many combinations do.
const path = require('path');
const Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
const { LEVELS } = require(path.join(__dirname, '..', 'js', 'levels.js'));

const args = process.argv.slice(2);
const target = args[0];
const depthArg = args.indexOf('--depth') >= 0 ? +args[args.indexOf('--depth') + 1] : null;
const FR = args.indexOf('--frames') >= 0 ? +args[args.indexOf('--frames') + 1] : 3600;

function legalOps(lv) {
  const st = Engine.load(lv);
  const fields = [];
  for (const e of st.ents) for (const p of e.schema) fields.push({ id: e.id, p, t: Engine.TYPES[p], lock: !!e.lock[p] });
  const ops = [];
  const open = fields.filter(f => !f.lock);
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
    if (open[i].t !== open[j].t) continue;
    ops.push(['swap', open[i].id + '.' + open[i].p, open[j].id + '.' + open[j].p]);
  }
  if (lv.pointers) {
    for (const s of fields) for (const d of open) {
      if (s.t !== d.t || (s.id === d.id && s.p === d.p)) continue;
      ops.push(['ptr', s.id + '.' + s.p, d.id + '.' + d.p]);
    }
  }
  return ops;
}

function run(lv, seq) {
  const st = Engine.load(lv);
  for (const [op, a, b] of seq) {
    const [ai, ap] = a.split('.'), [bi, bp] = b.split('.');
    const err = op === 'ptr' ? Engine.pointer(st, ai, ap, bi, bp) : Engine.swap(st, ai, ap, bi, bp);
    if (err) return null;
  }
  for (let f = 0; f < FR; f++) {
    Engine.step(st);
    if (st.status === 'won') return { frame: st.frame, frags: st.frags, total: st.fragTotal };
    if (st.status === 'dead') return null;
  }
  return null;
}

function solve(i) {
  const lv = LEVELS[i];
  const ops = legalOps(lv);
  const maxD = depthArg != null ? depthArg : Math.min(3, (lv.par || 1) + 1);
  const t0 = Date.now();
  const found = {};
  if (run(lv, [])) { console.log(`[${i}] ${lv.name}: WINS WITH 0 OPS (broken)`); return; }
  let runs = 0;
  function rec(seq, start, d) {
    if (d === 0) {
      runs++;
      const r = run(lv, seq);
      if (r) (found[seq.length] = found[seq.length] || []).push(seq.map(s => s.join(' ')).join(' ; ') + `  (f${r.frame}${r.total ? ' frag ' + r.frags + '/' + r.total : ''})`);
      return;
    }
    for (let k = lv.pointers ? 0 : start; k < ops.length; k++) {
      if (seq.length && ops[k] === seq[seq.length - 1]) continue;
      rec(seq.concat([ops[k]]), k + 1, d - 1);
    }
  }
  for (let d = 1; d <= maxD; d++) {
    if (lv.ram != null && d > lv.ram) break;
    rec([], 0, d);
    if (found[d] && d >= (lv.par || 1)) break;
  }
  const depths = Object.keys(found).map(Number).sort((a, b) => a - b);
  const min = depths[0];
  const flag = min == null ? 'NO SOLUTION (frame-0 search)' : min < (lv.par || 1) ? `EASIER THAN PAR (min ${min} < par ${lv.par})` : min > lv.par ? `PAR TOO LOW (min ${min})` : 'ok';
  console.log(`[${i}] ${lv.name.padEnd(22)} ops=${ops.length} runs=${runs} ${((Date.now() - t0) / 1000).toFixed(1)}s  min=${min} par=${lv.par}  ${flag}`);
  if (min != null) {
    const list = found[min];
    console.log(`     ${list.length} winning combo(s) at depth ${min}:`);
    list.slice(0, 6).forEach(s => console.log('       ' + s));
  }
}

if (target === 'all') LEVELS.forEach((_, i) => solve(i));
else solve(+target);

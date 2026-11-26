// Headless level verifier: node tools/verify.js [levelIndex] [--trace]
// For each level: (1) running with NO swaps must not win, (2) the stored solution must win.
const path = require('path');
global.window = undefined;
const Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
const { LEVELS } = require(path.join(__dirname, '..', 'js', 'levels.js'));

const args = process.argv.slice(2);
const only = args.find(a => /^\d+$/.test(a));
const trace = args.includes('--trace');
const MAXF = 60 * 90;

function run(level, sol, doTrace) {
  const st = Engine.load(level);
  const steps = (sol || []).slice().sort((a, b) => a[0] - b[0]);
  let si = 0;
  const log = [];
  for (let f = 0; f < MAXF; f++) {
    while (si < steps.length && steps[si][0] <= st.frame) {
      const [t, op, a, b] = steps[si++];
      const [ai, ap] = a.split('.'); const [bi, bp] = b.split('.');
      const err = op === 'ptr' ? Engine.pointer(st, ai, ap, bi, bp) : Engine.swap(st, ai, ap, bi, bp);
      if (err) return { result: 'OPFAIL:' + err + ' @' + t + ' ' + a + ' ' + b, frame: st.frame, log };
    }
    const ev = Engine.step(st);
    const w = st.walker;
    if (doTrace && (st.frame % 15 === 0 || ev.length)) {
      const evs = ev.map(e => e.type + (e.why ? '(' + e.why + ')' : '') + (e.e ? ':' + e.e.id : '')).join(',');
      log.push(`f${st.frame} x=${w.x.toFixed(2)} y=${w.y.toFixed(2)} vx=${w.vx.toFixed(3)} vy=${w.vy.toFixed(3)} g=${w.grounded ? 1 : 0} ${evs}`);
    }
    if (st.status === 'won') return { result: 'WIN', frame: st.frame, frags: st.frags + '/' + st.fragTotal, log };
    if (st.status === 'dead') return { result: 'DEAD:' + st.death.reason + (st.death.by ? '(' + st.death.by + ')' : ''), frame: st.frame, log, x: w.x, y: w.y };
  }
  return { result: 'TIMEOUT', frame: MAXF, log, x: st.walker.x, y: st.walker.y };
}

let bad = 0;
LEVELS.forEach((lv, i) => {
  if (only != null && +only !== i) return;
  const base = run(lv, [], false);
  const sol = run(lv, lv.solution, trace && only != null);
  const extra = (lv.alt || []).map(a => run(lv, a.sol, false).result + ' (' + a.name + ')');
  const okBase = base.result !== 'WIN';
  const okSol = sol.result === 'WIN';
  if (!okBase || !okSol) bad++;
  console.log(`${okBase && okSol ? 'OK ' : 'BAD'} [${i}] ${lv.name.padEnd(22)} noswap=${base.result}@${base.frame}  solution=${sol.result}@${sol.frame} frags=${sol.frags || '-'}  ${extra.join(' | ')}`);
  if (trace && only != null) console.log(sol.log.join('\n'));
});
process.exitCode = bad ? 1 : 0;

// --scan N : try solution step timing at every frame (single-step solutions) and summarise outcome ranges
if (args.includes('--scan') && only != null) {
  const lv = LEVELS[+only];
  const step = lv.solution[lv.solution.length - 1];
  let prev = null, start = 0;
  for (let t = 0; t <= 420; t++) {
    const sol = lv.solution.slice(0, -1).concat([[t, step[1], step[2], step[3]]]);
    const r = run(lv, sol, false);
    const key = r.result + (r.frags ? ' frags=' + r.frags : '');
    if (key !== prev) { if (prev) console.log(`  t=${start}-${t - 1}: ${prev}`); prev = key; start = t; }
  }
  console.log(`  t=${start}-420: ${prev}`);
}

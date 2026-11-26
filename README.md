# SWAPFILE — a debugger's platformer

You're a QA debugger attached to **Sunny Meadows**, a platformer from 1998 that never shipped. Its hero, **PIX**, walks on his own and can't be controlled. He has been walking into the same spikes for 28 years. You can't move him. What you can do is **edit the memory of everything around him**.

## Run it

No build step and no dependencies. Plain HTML, CSS and JavaScript.

- **Quickest:** double-click `index.html`.
- **Local server (recommended):** `python -m http.server 5173`, then open http://localhost:5173

## Controls

| Input | Action |
|---|---|
| Click an object | Open its **Component Inspector** |
| Click a field, then another object's field | **Swap** the two values (they must be the same type) |
| `TAB` | Switch between SWAP and **POINTER** mode (Act III+) |
| `SPACE` | Run / pause. Each level starts paused at a *breakpoint* |
| hold `SHIFT` or right mouse | **Slow-mo** at 10% speed, for swaps in mid-air |
| hold `Z` | **Rewind** time. Swaps are undone too. When you let go, the game pauses |
| click the timeline | Scrub to any earlier frame |
| `R` / `H` / `M` / `Esc` | Restart / hint / mute / memory map |

## What changed from the original concept

The core idea stays the same: same-type swapping, a deterministic walker, four acts, the Garbage Collector boss. These are the additions meant to make it stick:

- **Execution trace preview.** While paused, a dotted line shows where PIX will go over the next ~4 seconds. A red ✕ means he dies and green means he wins. Every swap you make while paused redraws the line immediately.
- **Cross-field type punning.** A float fits any float field. For example, a block's `Mass 1.5` can become a pad's `Restitution`. Reading the actual numbers matters: the anvil's `5.0` launches PIX into the laser ceiling.
- **Pointers you can actually use.** A pointer can *read* a `const` field, and writing through an alias changes the const memory (`const_cast`). This trick is needed again for the final boss.
- **"Only one FALSE" puzzles.** A swap moves a value and a pointer shares it, so the two tools solve problems differently.
- **RAM budget plus par.** Each level has a limited number of swaps (RAM) and a par score. Stars are awarded for finishing, for meeting par, and for collecting the level's data fragment.
- **Data fragments.** These are 15 pieces of lore that tell the story of Mark and Kira, the two developers, and why the game was left unfinished. You can read them all in the DATA LOG.
- **Diagnostic console.** Every time PIX turns, panics or dies, the console logs the variable that caused it, e.g. `[WARN] PIX panic: spikes.Is_Hazard == TRUE within 3 tiles`.
- **Presentation.** Neon wireframe visuals with bloom, a CRT overlay and glitch effects. PIX is drawn in code, blinks, and changes his face when panicking. Swap tethers carry moving data packets, and objects visibly change when a property changes (a hazard cloud turns into a red storm). Music and sound effects are synthesized live, with no audio files.

## Levels (51)

| Act | # | New idea |
|---|---|---|
| I — RUNTIME | 12 | float/bool swaps, exit flags, fear-steering, solidity, crate pushing, PIX as an object, mid-air timing |
| II — CONST | 10 | padlocks, RAM budgets, zero-g, vec2 velocity, cross-field type punning, one swap fixing two bugs |
| III — POINTERS | 10 | aliasing const memory, shared values, write-through (`const_cast`), synced movers, broadcasts |
| IV — OVERFLOW | 10 | the heap **wraps around** (fall off the bottom → enter at the top, walk off one side → enter the other), PIX noclip (`Is_Solid`), runaway restitution &gt; 1 |
| V — COLLECT | 9 | Garbage Collector chases (sideways, top-down, from both sides), stop-the-world, dangling pointers, the boss |

You can always skip one level: a level unlocks when either of the two before it is compiled.

## Project layout

```
index.html        UI shell + overlays
css/style.css     styling, CRT, cards
js/engine.js      deterministic simulation (no DOM; also runs in Node)
js/levels.js      level data + verified solutions
js/render.js      canvas renderer, bloom, particles, PIX sprite
js/audio.js       WebAudio synth sfx + generative music
js/main.js        game loop, inspector, swaps, rewind, menus, saves
tools/verify.js   headless check: every level unwinnable without swaps, winnable with its solution
tools/solve.js    brute-force solver: finds the true minimum ops and unintended shortcuts
```

### Level verification

```
node tools/verify.js            # every level: unwinnable without swaps, winnable with its solution
node tools/verify.js 5 --scan   # outcome for each possible frame of a timed swap
node tools/verify.js 5 --trace  # frame-by-frame walker log
node tools/solve.js 12 --depth 2 # every winning op combination at the breakpoint
```

Progress is saved to `localStorage`.

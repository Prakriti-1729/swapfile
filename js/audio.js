/* SWAPFILE — WebAudio synth: sfx + generative chiptune/ambient score. No audio files. */
(function () {
  'use strict';
  const A = { ready: false, muted: false, musicOn: true, act: 1, slow: false, tense: false };
  let ac, master, sfxBus, musBus, musFilter, comp, noiseBuf;

  A.init = function () {
    if (A.ready) { if (ac.state === 'suspended') ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = ac.createGain(); master.gain.value = A.muted ? 0 : 0.8;
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.55 * (A.sfxVol != null ? A.sfxVol : 1);
    musBus = ac.createGain(); musBus.gain.value = 0.32 * (A.musicVol != null ? A.musicVol : 1);
    musFilter = ac.createBiquadFilter(); musFilter.type = 'lowpass'; musFilter.frequency.value = 5200; musFilter.Q.value = 0.7;
    const delay = ac.createDelay(1); delay.delayTime.value = 0.375;
    const fb = ac.createGain(); fb.gain.value = 0.32;
    const wet = ac.createGain(); wet.gain.value = 0.28;
    musBus.connect(musFilter); musFilter.connect(comp);
    musFilter.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(comp);
    sfxBus.connect(comp); comp.connect(master); master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    A.ready = true;
    startMusic();
  };

  A.setVolumes = function (music, sfx) {
    A.musicVol = music; A.sfxVol = sfx;
    if (!A.ready) return;
    musBus.gain.setTargetAtTime(0.32 * music, ac.currentTime, 0.05);
    sfxBus.gain.setTargetAtTime(0.55 * sfx, ac.currentTime, 0.05);
  };
  A.setMuted = function (m) {
    A.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05);
  };
  A.setSlow = function (on) {
    if (!A.ready || A.slow === on) return;
    A.slow = on;
    musFilter.frequency.setTargetAtTime(on ? 700 : 5200, ac.currentTime, 0.08);
  };
  A.setAct = function (n, tense) { A.act = n; A.tense = !!tense; };

  function env(g, t, a, peak, dcy, sus) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus || 0.0001), t + a + dcy);
  }
  function tone(type, f0, f1, dur, vol, opt) {
    if (!A.ready) return;
    opt = opt || {};
    const t = ac.currentTime + (opt.delay || 0);
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    env(g, t, opt.a || 0.004, vol, dur);
    let node = o;
    if (opt.filter) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opt.filter; o.connect(f); node = f; }
    node.connect(g); g.connect(opt.bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq, type, delay) {
    if (!A.ready) return;
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq || 1000; f.Q.value = 0.8;
    const g = ac.createGain(); env(g, t, 0.003, vol, dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  const N = n => 440 * Math.pow(2, (n - 69) / 12);

  A.sfx = function (name, p) {
    if (!A.ready || A.muted) return;
    switch (name) {
      case 'hover': tone('sine', 2400, 2400, 0.02, 0.03); break;
      case 'select': tone('square', 660, 990, 0.06, 0.06, { filter: 3000 }); break;
      case 'arm': tone('square', N(72), N(72), 0.06, 0.06, { filter: 2500 }); tone('square', N(79), N(79), 0.08, 0.06, { filter: 2500, delay: 0.05 }); break;
      case 'disarm': tone('triangle', 600, 300, 0.08, 0.06); break;
      case 'swap':
        [72, 76, 79, 84].forEach((n, i) => tone('square', N(n), N(n), 0.07, 0.07, { filter: 4000, delay: i * 0.04 }));
        noise(0.25, 0.08, 3000, 'highpass');
        tone('sine', 180, 900, 0.22, 0.12);
        break;
      case 'ptr':
        [84, 79, 76, 72].forEach((n, i) => tone('triangle', N(n), N(n), 0.08, 0.1, { delay: i * 0.045 }));
        tone('sine', 1200, 300, 0.3, 0.08);
        break;
      case 'error': tone('sawtooth', 120, 90, 0.16, 0.08, { filter: 900 }); tone('square', 95, 95, 0.12, 0.05, { delay: 0.08, filter: 600 }); break;
      case 'jump': tone('square', 320, 640, 0.1, 0.05, { filter: 2400 }); break;
      case 'bounce': tone('sine', 160, 980, 0.28, 0.16); tone('triangle', 320, 1300, 0.22, 0.05); break;
      case 'land': noise(0.08, 0.08, 300, 'lowpass'); break;
      case 'step': noise(0.02, 0.015, 2000, 'bandpass'); break;
      case 'turn': tone('triangle', 520, 520, 0.05, 0.04); tone('triangle', 390, 390, 0.07, 0.04, { delay: 0.06 }); break;
      case 'panic': [0, 1, 2].forEach(i => tone('square', 1200, 1200, 0.035, 0.04, { delay: i * 0.06, filter: 3000 })); break;
      case 'push': noise(0.06, 0.03, 500, 'lowpass'); break;
      case 'thud': noise(0.2, Math.min(0.25, 0.08 + (p || 0) * 0.4), 140, 'lowpass'); tone('sine', 90, 40, 0.2, 0.15); break;
      case 'shatter': for (let i = 0; i < 6; i++) noise(0.05 + Math.random() * 0.1, 0.07, 4000 + Math.random() * 5000, 'bandpass', i * 0.025); tone('triangle', 2600, 1800, 0.25, 0.04); break;
      case 'die':
        noise(0.5, 0.25, 800, 'lowpass');
        tone('sawtooth', 440, 40, 0.7, 0.14, { filter: 2000 });
        tone('square', 220, 30, 0.6, 0.08, { delay: 0.05, filter: 1200 });
        break;
      case 'win':
        [72, 76, 79, 83, 84, 88, 91, 96].forEach((n, i) => tone(i % 2 ? 'triangle' : 'square', N(n), N(n), 0.18, 0.06, { delay: i * 0.07, filter: 5000 }));
        tone('sine', N(48), N(48), 0.9, 0.12);
        break;
      case 'frag': [88, 95, 100, 103].forEach((n, i) => tone('sine', N(n), N(n), 0.25, 0.06, { delay: i * 0.05 })); break;
      case 'reverse': tone('triangle', 300, 260, 0.06, 0.03); break;
      case 'rewind': tone('sawtooth', 300 + Math.random() * 200, 200, 0.05, 0.02, { filter: 1500 }); break;
      case 'type': tone('square', 1800 + Math.random() * 400, 1800, 0.012, 0.012, { filter: 4000 }); break;
      case 'boot': tone('square', 880, 880, 0.08, 0.05); tone('square', 1760, 1760, 0.12, 0.05, { delay: 0.1 }); break;
      case 'gcfreed':
        noise(1.2, 0.2, 200, 'lowpass');
        [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => tone('triangle', N(n), N(n), 0.4, 0.08, { delay: 0.3 + i * 0.09 }));
        break;
      case 'wrap': tone('sawtooth', 1600, 80, 0.25, 0.06, { filter: 3000 }); noise(0.15, 0.06, 2500, 'highpass'); break;
      case 'unlock': [67, 71, 74, 79].forEach((n, i) => tone('triangle', N(n), N(n), 0.2, 0.07, { delay: i * 0.08 })); break;
      case 'star': tone('sine', N(84 + (p || 0) * 4), N(96 + (p || 0) * 4), 0.25, 0.08); tone('triangle', N(96), N(96), 0.2, 0.04, { delay: 0.05 }); break;
      case 'whoosh': noise(0.35, 0.07, 1200, 'bandpass'); tone('sine', 200, 900, 0.3, 0.05); break;
      case 'collected': noise(0.12, 0.06, 1500, 'bandpass'); tone('square', 200, 60, 0.15, 0.04, { filter: 800 }); break;
    }
  };

  // ---------------- generative music ----------------
  const PROG = {
    1: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],       // Am F C G
    2: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [52, 55, 59]],       // Dm Bb F Em
    3: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]],       // Em C G D
    4: [[53, 56, 60], [49, 53, 56], [56, 60, 63], [51, 55, 58]],       // Fm Db Ab Eb — overflow
    5: [[45, 48, 52], [46, 50, 53], [45, 48, 52], [44, 47, 51]],       // Am Bb Am Ab — tense
  };
  const SCALE = [0, 3, 5, 7, 10, 12, 15, 17];
  let step16 = 0, nextT = 0, timer = null, bar = 0;
  let padVoices = [];

  function startMusic() {
    nextT = ac.currentTime + 0.1;
    timer = setInterval(schedule, 25);
  }
  function bpm() { return (A.tense ? 132 : 104) * (A.slow ? 0.5 : 1); }
  function schedule() {
    if (!A.ready) return;
    const spb = 60 / bpm() / 4; // 16th
    while (nextT < ac.currentTime + 0.12) {
      playStep(step16, nextT, spb);
      nextT += spb;
      step16 = (step16 + 1) % 16;
      if (step16 === 0) bar++;
    }
  }
  function musNote(type, f, t, dur, vol, filt) {
    if (A.muted || !A.musicOn) return;
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n = o;
    if (filt) { const f2 = ac.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = filt; o.connect(f2); n = f2; }
    n.connect(g); g.connect(musBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function rnd(seed) { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }
  function playStep(s, t, spb) {
    const prog = PROG[A.act] || PROG[1];
    const chord = prog[Math.floor(bar / 2) % prog.length];
    const root = chord[0];
    // pad: on bar starts
    if (s === 0 && bar % 2 === 0) {
      chord.forEach((n, i) => {
        musNote('sawtooth', N(n), t, spb * 32, 0.022, 900 + i * 200);
        musNote('sawtooth', N(n) * 1.004, t, spb * 32, 0.018, 900);
      });
    }
    // bass
    if (s % 8 === 0) musNote('triangle', N(root - 12), t, spb * 6, 0.13);
    if (A.tense && s % 4 === 2) musNote('square', N(root - 12), t, spb * 1.5, 0.04, 400);
    // arp
    const density = A.tense ? 0.8 : 0.55;
    if (rnd(bar * 16 + s + A.act * 999) < density && s % 2 === 0) {
      const deg = SCALE[Math.floor(rnd(bar * 7 + s * 3 + A.act) * SCALE.length)];
      const n = root + 12 + deg;
      musNote('square', N(n), t, spb * 1.8, 0.022, 2200);
      musNote('triangle', N(n + 12), t, spb * 1.2, 0.012);
    }
    // hat
    if (s % 4 === 2 || (A.tense && s % 2 === 1)) {
      if (!A.muted && A.musicOn) {
        const src = ac.createBufferSource(); src.buffer = noiseBuf;
        const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        const g = ac.createGain(); g.gain.setValueAtTime(0.025, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        src.connect(f); f.connect(g); g.connect(musBus); src.start(t, rnd(s) * 0.5); src.stop(t + 0.05);
      }
    }
    // kick in tense mode
    if (A.tense && s % 4 === 0) {
      if (!A.muted && A.musicOn) {
        const o = ac.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        const g = ac.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(musBus); o.start(t); o.stop(t + 0.2);
      }
    }
  }

  window.Audio2 = A;
})();

// Motor de áudio: simula cada motor à frente do relógio do AudioContext e agenda os
// parâmetros (frequência, envelope) com precisão de amostra. O setInterval só decide
// quando calcular os próximos ~120 ms; nenhuma amostra é gerada por ele.

import { bentMidi, mtof, noteAt } from './score.mjs';
import { DEFAULT_PHYSICS, SIM_DT, stepMotor } from './physics.mjs';

const LOOKAHEAD = 0.12;
const HISTORY = 6; // segundos de histórico para os gráficos
export const COLORS = ['#ff8f6b', '#5fd4ff', '#b7f36b', '#f5c74e', '#d792ff', '#ff6fae', '#7fe9c9', '#9fb0ff', '#ffb35c', '#c6e86a', '#7ab8ff', '#ff9fd2'];

let noiseBuffer = null;
const BASE_NOISE = 0.05; // atrito e rolamentos; notas de percussão pedem mais (note.noise)
const REATTACK_DIP = 0.03; // duração da piscada de volume num re-ataque da mesma nota (s)

// Forma de onda da excitação: cada passo completo é um "tranco" de torque. Em passo
// completo o tranco é abrupto (muitos harmônicos); com micropassos a corrente vira
// quase senoidal e o som perde brilho.
function stepWave(ctx, micro) {
  const n = 48, real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  const slope = 0.75 + 0.32 * Math.log2(micro);
  for (let k = 1; k <= n; k++) imag[k] = 1 / k ** slope;
  return ctx.createPeriodicWave(real, imag);
}

class Motor {
  constructor(engine, midi) {
    this.engine = engine;
    this.midi = midi;
    this.enabled = true;   // participa da música
    this.hold = false;     // toca a nota escolhida continuamente
    this.volume = 0.8;
    this.state = { w: 0 };
    this.history = [];
    this.nodes = null;
    this.angle = 0;
  }

  build() {
    const { ctx } = this.engine, P = this.engine.physics;
    const g = (value) => { const node = ctx.createGain(); node.gain.value = value; return node; };
    const n = {};
    n.ideal = ctx.createOscillator();
    n.idealEnv = g(0);
    n.mixA = g(this.engine.model === 'ideal' ? 1 : 0);
    n.ideal.connect(n.idealEnv).connect(n.mixA);

    n.mech = ctx.createOscillator();
    n.mech.setPeriodicWave(stepWave(ctx, P.micro));
    n.noise = ctx.createBufferSource();
    n.noise.buffer = noiseBuffer;
    n.noise.loop = true;
    n.noiseBand = ctx.createBiquadFilter();
    Object.assign(n.noiseBand, { type: 'bandpass' });
    n.noiseBand.frequency.value = 2500;
    n.noiseGain = g(BASE_NOISE);
    n.mechEnv = g(0);
    n.resonator = ctx.createBiquadFilter();
    n.resonator.type = 'peaking';
    n.body = ctx.createBiquadFilter();
    n.body.type = 'lowpass';
    n.body.frequency.value = 6500;
    // Desbalanceamento do rotor: modulação de amplitude uma vez por volta.
    n.wobble = g(1);
    n.lfo = ctx.createOscillator();
    n.lfoDepth = g(0.18);
    n.mixB = g(this.engine.model === 'ideal' ? 0 : 1);
    n.mech.connect(n.mechEnv);
    n.noise.connect(n.noiseBand).connect(n.noiseGain).connect(n.mechEnv);
    n.mechEnv.connect(n.resonator).connect(n.body).connect(n.wobble).connect(n.mixB);
    n.lfo.connect(n.lfoDepth).connect(n.wobble.gain);

    n.volume = g(this.volume);
    n.analyser = ctx.createAnalyser();
    n.analyser.fftSize = 2048;
    n.mixA.connect(n.volume);
    n.mixB.connect(n.volume);
    n.volume.connect(n.analyser);
    n.volume.connect(this.engine.sum);
    for (const source of [n.ideal, n.mech, n.noise, n.lfo]) source.start();
    this.nodes = n;
    this.sched = {};
    this.applyPhysics(P);
  }

  applyPhysics(P) {
    const n = this.nodes;
    if (!n) return;
    n.mech.setPeriodicWave(stepWave(this.engine.ctx, P.micro));
    n.resonator.frequency.value = P.resFreq;
    n.resonator.Q.value = Math.min(30, 1 / (2 * P.damping));
    n.resonator.gain.value = 4 + 20 * P.resonance;
  }

  setVolume(value) {
    this.volume = value;
    this.nodes?.volume.gain.setTargetAtTime(value, this.engine.ctx.currentTime, 0.02);
  }

  destroy() {
    if (!this.nodes) return;
    for (const source of [this.nodes.ideal, this.nodes.mech, this.nodes.noise, this.nodes.lfo]) source.stop();
    this.nodes.volume.disconnect();
  }

  // Parâmetros automatizados: frequência mecânica, LFO, envelopes, frequência ideal.
  params() {
    const n = this.nodes;
    return [n.mech.frequency, n.lfo.frequency, n.mechEnv.gain, n.idealEnv.gain, n.ideal.frequency, n.noiseGain.gain];
  }

  simulate(t, cmd, P) {
    // Re-ataque da mesma nota: o motor segue girando, só o volume pisca (REATTACK_DIP).
    const id = cmd ? cmd.src ?? cmd : null;
    if (id !== this.lastNote) {
      if (id && cmd.reattack) this.dipUntil = t + REATTACK_DIP;
      this.lastNote = id;
    }
    const dip = t < (this.dipUntil ?? 0);
    const s = stepMotor(this.state, cmd && { freq: mtof(cmd.midi), vel: cmd.vel }, P);
    this.state = s;
    this.history.push({ t, midi: cmd ? cmd.midi : null, ...s });
    const n = this.nodes, sc = this.sched;
    if (!n) return;

    // Frequência mecânica: rampas lineares só quando o valor muda de fato.
    const f = Math.max(1, s.w);
    if (sc.f === undefined || Math.abs(f - sc.f) > Math.max(0.05, sc.f * 0.0005)) {
      if (sc.fAt !== undefined && t - sc.fAt > SIM_DT * 1.5) n.mech.frequency.setValueAtTime(sc.f, t - SIM_DT);
      n.mech.frequency.linearRampToValueAtTime(f, t);
      n.lfo.frequency.setValueAtTime(s.w / P.steps, t);
      sc.f = f;
      sc.fAt = t;
    }
    const noise = cmd?.noise ?? BASE_NOISE;
    if (noise !== sc.noise) {
      n.noiseGain.gain.setValueAtTime(noise, t);
      sc.noise = noise;
    }
    const mechAmp = s.amp * 0.32 * (dip ? 0.2 : 1);
    if (sc.mech === undefined || Math.abs(mechAmp - sc.mech) > 0.004) {
      const release = dip ? 0.005 : Math.min(0.2, Math.max(0.01, 0.004 / P.damping));
      n.mechEnv.gain.setTargetAtTime(mechAmp, t, mechAmp > sc.mech ? 0.003 : release);
      sc.mech = mechAmp;
    }
    // Modelo A: senoide exata na frequência da nota, sem dinâmica.
    const idealAmp = cmd ? cmd.vel * 0.3 * (dip ? 0.2 : 1) : 0;
    if (cmd && cmd.midi !== sc.midi) {
      n.ideal.frequency.setValueAtTime(mtof(cmd.midi), t);
      sc.midi = cmd.midi;
    }
    if (idealAmp !== sc.ideal) {
      n.idealEnv.gain.setTargetAtTime(idealAmp, t, idealAmp > 0 ? 0.004 : 0.015);
      sc.ideal = idealAmp;
    }
  }

  // Estado simulado no instante t (o mais recente com tempo ≤ t).
  at(t) {
    const h = this.history;
    let lo = 0, hi = h.length - 1, found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (h[mid].t <= t) { found = h[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.physics = { ...DEFAULT_PHYSICS };
    this.model = 'mech';
    this.motors = [];
    this.transport = { playing: false, start: 0, rate: 1, loop: true, score: null };
    this.original = { buffer: null, source: null, gain: null, level: 0 };
    this.simTime = 0;
  }

  addMotor(midi) {
    const motor = new Motor(this, midi);
    this.motors.push(motor);
    if (this.ctx) { motor.build(); this.resync(); }
    return motor;
  }

  removeMotor(motor) {
    motor.destroy();
    this.motors.splice(this.motors.indexOf(motor), 1);
    this.resync();
  }

  async start() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const ctx = this.ctx = new AudioContext({ latencyHint: 'interactive' });
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // sum = S(t) = Σ s_i(t), antes de qualquer compressão: é o que o osciloscópio mostra.
    this.sum = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0.55;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.ratio.value = 8;
    this.sum.connect(this.analyser);
    this.sum.connect(this.master).connect(this.limiter).connect(ctx.destination);
    this.original.gain = ctx.createGain();
    this.original.gain.gain.value = this.original.level;
    this.original.gain.connect(this.limiter);

    for (const motor of this.motors) motor.build();
    this.simTime = ctx.currentTime;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  tick() {
    const now = this.ctx.currentTime;
    if (this.simTime < now) this.simTime = now; // aba ficou em segundo plano
    const horizon = now + LOOKAHEAD;
    while (this.simTime < horizon) {
      for (const motor of this.motors) motor.simulate(this.simTime, this.command(motor, this.simTime), this.physics);
      this.simTime += SIM_DT;
    }
    const oldest = now - HISTORY;
    for (const motor of this.motors) {
      const h = motor.history;
      let cut = 0;
      while (cut < h.length && h[cut].t < oldest) cut++;
      if (cut) h.splice(0, cut);
    }
  }

  // O que o motor deve tocar em t: a nota da partitura, ou a nota fixa se "segurar" estiver ligado.
  command(motor, t) {
    if (!motor.enabled) return null;
    const tr = this.transport;
    if (tr.playing && t >= tr.start) {
      const songTime = this.songTimeAt(t);
      const track = tr.score.tracks[this.motors.indexOf(motor)];
      const note = songTime !== null && track ? noteAt(track, songTime) : null;
      if (note) return note.bends ? { midi: bentMidi(note, songTime), vel: note.vel, noise: note.noise, reattack: note.reattack, src: note } : note;
    }
    return motor.hold ? { midi: motor.midi, vel: 0.8 } : null;
  }

  songTimeAt(t) {
    const tr = this.transport;
    if (!tr.playing) return null;
    const time = Math.max(0, (t - tr.start) * tr.rate);
    if (tr.loop) return time % tr.score.duration;
    return time < tr.score.duration ? time : null;
  }

  songTime() { return this.ctx ? this.songTimeAt(this.ctx.currentTime) : null; }

  // Descarta o que já foi agendado e refaz a simulação a partir de agora, para que uma
  // mudança (nota, parâmetro, transporte) seja ouvida em ~15 ms, não depois do lookahead.
  resync() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + 0.015;
    for (const motor of this.motors) {
      if (!motor.nodes) continue;
      const h = motor.history;
      while (h.length && h[h.length - 1].t >= t0) h.pop();
      motor.state = h.length ? h[h.length - 1] : { w: 0 };
      for (const param of motor.params()) param.cancelScheduledValues(t0);
      const f = Math.max(1, motor.state.w);
      motor.nodes.mech.frequency.setValueAtTime(f, t0);
      motor.sched = { f, fAt: t0 };
    }
    this.simTime = t0;
    this.tick();
  }

  setPhysics(changes) {
    Object.assign(this.physics, changes);
    for (const motor of this.motors) motor.applyPhysics(this.physics);
    this.resync();
  }

  setModel(model) {
    this.model = model;
    const now = this.ctx?.currentTime ?? 0;
    for (const motor of this.motors) {
      if (!motor.nodes) continue;
      motor.nodes.mixA.gain.setTargetAtTime(model === 'ideal' ? 1 : 0, now, 0.02);
      motor.nodes.mixB.gain.setTargetAtTime(model === 'ideal' ? 0 : 1, now, 0.02);
    }
  }

  setOriginalLevel(level) {
    this.original.level = level;
    this.original.gain?.gain.setTargetAtTime(level, this.ctx.currentTime, 0.03);
  }

  async loadOriginal(url) {
    this.original.buffer = null;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Não foi possível carregar o áudio original.');
    this.original.buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
  }

  play(score, { from = 0, original = false } = {}) {
    this.stop(false);
    const tr = this.transport;
    tr.score = score;
    tr.playing = true;
    tr.start = this.ctx.currentTime + 0.05 - from / tr.rate;
    if (original) this.startOriginal(from);
    this.resync();
  }

  startOriginal(from) {
    const o = this.original, tr = this.transport;
    if (!o.buffer) return;
    const source = o.source = this.ctx.createBufferSource();
    source.buffer = o.buffer;
    source.playbackRate.value = tr.rate;
    source.loop = tr.loop;
    source.loopEnd = Math.min(o.buffer.duration, tr.score.duration);
    source.connect(o.gain);
    source.start(this.ctx.currentTime + 0.05, from % o.buffer.duration);
  }

  stop(sync = true) {
    this.transport.playing = false;
    if (this.original.source) { this.original.source.stop(); this.original.source = null; }
    if (sync) this.resync();
  }

  setRate(rate) {
    const tr = this.transport;
    if (tr.playing && this.ctx) {
      const now = this.ctx.currentTime, songTime = Math.max(0, (now - tr.start) * tr.rate);
      tr.start = now - songTime / rate;
      this.original.source?.playbackRate.setValueAtTime(rate, now);
    }
    tr.rate = rate;
    this.resync();
  }

  setLoop(loop) {
    const tr = this.transport;
    if (tr.playing && this.ctx) {
      // Mantém a posição atual da volta em vez da contagem desde o início.
      const now = this.ctx.currentTime;
      tr.start = now - Math.max(0, this.songTimeAt(now) ?? 0) / tr.rate;
    }
    tr.loop = loop;
    if (this.original.source) this.original.source.loop = loop;
  }
}

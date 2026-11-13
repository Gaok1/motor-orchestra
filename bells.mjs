// Sino sintético: modos de vibração com decaimentos diferentes. As caudas de
// golpes anteriores continuam soando, mesmo quando a voz passa à próxima nota.
import { mtof } from './score.mjs';

const MODES = [
  // frequência relativa, intensidade, tempo de decaimento (s)
  [0.5, 0.14, 0.9], [1, 1, 0.85], [1.19, 0.22, 0.6],
  [1.5, 0.16, 0.5], [2, 0.3, 0.4], [2.76, 0.13, 0.25], [4.07, 0.08, 0.15],
];
const TAIL = 4.5;

export class Bells {
  constructor(ctx, output) {
    this.ctx = ctx;
    this.output = output;
    this.strikes = new Set();
    this.lastNote = null;
    this.lastPosition = null;
  }

  update(cmd, t, position) {
    const id = cmd ? cmd.src ?? cmd : null;
    const wrapped = position !== null && this.lastPosition !== null && position < this.lastPosition;
    if (cmd && (id !== this.lastNote || wrapped)) this.strike(cmd.midi, cmd.vel, t);
    this.lastNote = id;
    this.lastPosition = position;
  }

  strike(midi, velocity, t) {
    const { ctx } = this;
    const frequency = mtof(midi);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.22 * velocity, t);
    envelope.gain.setValueAtTime(0.22 * velocity, t + TAIL - 0.03);
    envelope.gain.linearRampToValueAtTime(0, t + TAIL);
    envelope.connect(this.output);
    const strike = { t, envelope, sources: [], gains: [] };
    this.strikes.add(strike);
    for (const [ratio, amplitude, decay] of MODES) {
      if (frequency * ratio >= ctx.sampleRate / 2) continue;
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.frequency.value = frequency * ratio;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(amplitude, t + 0.002);
      gain.gain.exponentialRampToValueAtTime(amplitude * Math.exp(-TAIL / decay), t + TAIL);
      oscillator.connect(gain).connect(envelope);
      strike.sources.push(oscillator);
      strike.gains.push(gain);
      oscillator.start(t);
      oscillator.stop(t + TAIL);
    }
    let remaining = strike.sources.length;
    const cleanup = () => {
      envelope.disconnect();
      for (const gain of strike.gains) gain.disconnect();
      this.strikes.delete(strike);
    };
    for (const source of strike.sources) source.onended = () => {
      source.disconnect();
      if (--remaining === 0) cleanup();
    };
    if (!remaining) cleanup();
  }

  // Também cancela golpes que estavam no lookahead: parar/pular não deixa notas
  // antigas começarem a tocar depois da mudança de transporte.
  reset(t) {
    for (const strike of this.strikes) {
      const param = strike.envelope.gain;
      param.cancelScheduledValues(t);
      if (strike.t >= t) param.setValueAtTime(0, t);
      else param.setTargetAtTime(0, t, 0.005);
      for (const source of strike.sources) source.stop(t + 0.03);
    }
    this.lastNote = null;
    this.lastPosition = null;
  }
}

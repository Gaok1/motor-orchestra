import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMOS, arrange, arrangeMotors, bentMidi, dynamicLines, mtof, noteAt, parseNote, parseScore, percussionTrack } from '../score.mjs';
import { Engine } from '../engine.mjs';
import { DEFAULT_PHYSICS, SIM_DT, rpmFromPulses, stepMotor } from '../physics.mjs';

const run = (P, freq, seconds) => {
  let s = { w: 0 };
  for (let i = 0; i < seconds / SIM_DT; i++) s = stepMotor(s, { freq, vel: 1 }, P, SIM_DT, () => 0.5);
  return s;
};

test('afinação temperada e nomes de nota', () => {
  assert.equal(mtof(69), 440);
  assert.ok(Math.abs(mtof(73) - 554.37) < 0.01);
  assert.ok(Math.abs(mtof(76) - 659.26) < 0.01);
  assert.equal(parseNote('A4'), 69);
  assert.equal(parseNote('C#5'), 73);
  assert.equal(parseNote('Bb3'), 58);
  assert.equal(parseNote('H2'), null);
});

test('RPM a partir dos pulsos: 440 pulsos/s, 200 passos, sem micropasso = 132 RPM', () => {
  assert.equal(rpmFromPulses(440, { steps: 200, micro: 1 }), 132);
  assert.equal(rpmFromPulses(440 * 16, { steps: 200, micro: 16 }), 132);
});

test('motor dentro dos limites converge para a nota', () => {
  const s = run({ ...DEFAULT_PHYSICS, resonance: 0 }, 440, 0.3);
  assert.ok(Math.abs(s.w - 440) < 0.5, `w=${s.w}`);
  assert.ok(Math.abs(s.rpm - 132) < 0.2);
  assert.equal(s.speedSat, false);
});

test('velocidade máxima limita a nota e o motor não acompanha', () => {
  const P = { ...DEFAULT_PHYSICS, resonance: 0, maxRpm: 300 }; // 1000 passos/s
  const s = run(P, mtof(88), 0.5); // Mi6 ≈ 1319 Hz
  assert.equal(s.speedSat, true);
  assert.ok(Math.abs(s.w - 1000) < 1);
  assert.equal(s.lagging, true);
});

test('micropassos multiplicam os pulsos até saturar o driver', () => {
  const P = { ...DEFAULT_PHYSICS, resonance: 0, micro: 32, driverMax: 20000 };
  const s = run(P, 880, 0.5);
  assert.equal(s.pulseCmd, 880 * 32);
  assert.equal(s.driverSat, true);
  assert.ok(Math.abs(s.w - 20000 / 32) < 1);
});

test('inércia maior atrasa a subida de velocidade', () => {
  const light = run({ ...DEFAULT_PHYSICS, resonance: 0 }, 440, 0.02);
  const heavy = run({ ...DEFAULT_PHYSICS, resonance: 0, inertia: 20 }, 440, 0.02);
  assert.ok(light.w > 400, `leve ${light.w}`);
  assert.ok(heavy.w < 100, `pesado ${heavy.w}`);
});

test('ressonância forte e pouco amortecida faz perder passos perto da frequência natural', () => {
  const P = { ...DEFAULT_PHYSICS, resonance: 1, damping: 0.05, resFreq: 440 };
  const s = run(P, 440, 0.3);
  assert.equal(s.losing, true);
  assert.ok(s.w < 440);
});

test('as demonstrações são partituras válidas', () => {
  for (const demo of Object.values(DEMOS)) {
    const score = parseScore(demo.text, demo.bpm);
    assert.ok(score.tracks.length >= 1 && score.duration > 2);
    for (const track of score.tracks) {
      for (let i = 1; i < track.length; i++) assert.ok(track[i].start >= track[i - 1].end, 'um motor toca uma nota por vez');
    }
  }
  const chords = parseScore(DEMOS.chords.text, DEMOS.chords.bpm);
  assert.deepEqual(chords.tracks.slice(0, 3).map((t) => noteAt(t, 0.1).midi), [69, 73, 76]);
});

test('erro de partitura aponta o motor e o token', () => {
  assert.throws(() => parseScore('A4 X9', 120), /Motor 1: nota inválida “X9”/);
});

// Notas como o transcritor entrega: [início, fim, midi, intensidade].
const job = (notes, duration = 4) => ({ title: 't', duration, notes });
const noOverlap = (track) => track.every((n, i) => i === 0 || n.start >= track[i - 1].end);

test('arranjo: melodia no motor 1, baixo no último, harmonia no meio', () => {
  const notes = [
    [0, 1, 72, 0.7], [1, 2, 74, 0.7], [2, 3, 76, 0.7],  // melodia (Dó5 Ré5 Mi5)
    [0, 3, 64, 0.5], [0, 3, 67, 0.5],                   // acorde (Mi4, Sol4)
    [0, 1.5, 36, 0.6], [1.5, 3, 43, 0.6],               // baixo (Dó2, Sol2)
  ];
  const score = arrange(job(notes), 4);
  assert.deepEqual(score.roles, ['melodia', 'harmonia', 'harmonia', 'baixo']);
  assert.deepEqual(score.tracks[0].map((n) => n.midi), [72, 74, 76]);
  assert.deepEqual(score.tracks[3].map((n) => n.midi), [36, 43]);
  assert.deepEqual(score.tracks.slice(1, 3).map((t) => t[0].midi).sort(), [64, 67]);
  for (const track of score.tracks) assert.ok(noOverlap(track), 'um motor toca uma nota por vez');
});

test('arranjo: a nota que acabou de atacar ganha da cauda da anterior', () => {
  // Fim da nota anterior estimado tarde (1,1 s) e a seguinte, mais grave, entra em 1,0 s.
  const score = arrange(job([[0, 1.1, 76, 0.7], [1.0, 2, 72, 0.7]]), 1);
  const [first, second] = score.tracks[0];
  assert.equal(first.midi, 76);
  assert.ok(Math.abs(first.end - 1.0) < 1e-9, `fim=${first.end}`);
  assert.equal(second.midi, 72);
});

test('arranjo: nota repetida colada vira re-ataque, sem silêncio que pararia o motor', () => {
  const score = arrange(job([[0, 0.5, 69, 0.7], [0.5, 1, 69, 0.7]]), 1);
  const [a, b] = score.tracks[0];
  assert.equal(score.tracks[0].length, 2);
  assert.equal(a.end, b.start);
  assert.equal(b.reattack, true);
});

test('arranjo: intensidade mínima descarta notas fracas e um motor só fica com a melodia', () => {
  const notes = [[0, 1, 72, 0.7], [0, 1, 40, 0.2], [0, 1, 64, 0.6]];
  const solo = arrange(job(notes), 1, { threshold: 0.3 });
  assert.deepEqual(solo.tracks.map((t) => t.map((n) => n.midi)), [[72]]);
  const two = arrange(job(notes), 2, { threshold: 0.3 });
  assert.deepEqual(two.tracks.map((t) => t.map((n) => n.midi)), [[72], []]);
  const loose = arrange(job(notes), 2, { threshold: 0.1 });
  assert.deepEqual(loose.tracks.map((t) => t.map((n) => n.midi)), [[72], [40]]);
});

test('linhas dinâmicas: motor 1 pega a linha mais forte, o 2 pega o que sobrou, sem sobreposição', () => {
  const notes = [
    [0, 1, 72, 0.8], [1, 2, 74, 0.8], [2, 3, 76, 0.8],   // linha forte
    [0, 3, 48, 0.4],                                     // nota longa fraca embaixo
    [1.5, 2.5, 60, 0.3],                                 // nota solta
  ];
  const [m1, m2, m3] = dynamicLines(notes, 3);
  assert.deepEqual(m1.map((n) => n.midi), [72, 74, 76]);
  assert.deepEqual(m2.map((n) => n.midi), [48]);
  assert.deepEqual(m3.map((n) => n.midi), [60]);
  for (const track of [m1, m2, m3]) assert.ok(noOverlap(track));
});

test('linhas dinâmicas: buraco curto vira legato, nota repetida vira re-ataque', () => {
  const [line] = dynamicLines([[0, 0.45, 60, 0.7], [0.5, 1, 62, 0.7], [1, 1.5, 62, 0.7]], 1);
  assert.equal(line[0].end, 0.5);                 // 50 ms de buraco preenchidos
  assert.equal(line[1].end, 1);                   // o Ré repetido não abre silêncio...
  assert.equal(line[2].reattack, true);           // ...é marcado como re-ataque
});

test('re-ataque: o motor segue girando na fronteira entre notas repetidas', () => {
  const engine = new Engine();
  const motor = engine.addMotor(69);
  const [line] = dynamicLines([[0, 0.5, 69, 0.8], [0.5, 1, 69, 0.8]], 1);
  Object.assign(engine.transport, { playing: true, start: 0, rate: 1, loop: false, score: { tracks: [line], duration: 1.5 } });
  let minW = Infinity;
  for (let t = 0; t < 0.9; t += 1 / 250) {
    motor.simulate(t, engine.command(motor, t), engine.physics);
    if (t > 0.3) minW = Math.min(minW, motor.state.w);
  }
  assert.ok(minW > 435, `velocidade mínima na fronteira: ${minW.toFixed(1)} passos/s (440 = Lá4)`);
});

test('percussão: um golpe por vez, bumbo tem prioridade sobre chimbal simultâneo', () => {
  const perc = percussionTrack([[0, 'hat', 1], [0.01, 'kick', 1], [0.25, 'snare', 0.5], [0.26, 'hat', 1]]);
  assert.deepEqual(perc.map((n) => n.kind), ['kick', 'snare']);
  assert.ok(noOverlap(perc));
});

test('arranjo por motores: com percussão o último motor bate e os outros tocam notas', () => {
  const job = {
    title: 't', duration: 3, notes: [[0, 1, 60, 0.5]], density: { media: [[0, 1, 60, 0.5], [0, 1, 67, 0.4]] },
    drums: [[0, 'kick', 1]],
  };
  const r = arrangeMotors(job, 3, { method: 'linhas', density: 'media', percussion: true });
  assert.equal(r.tracks.length, 3);
  assert.equal(r.roles[2], 'percussão');
  assert.deepEqual(r.tracks.slice(0, 2).flat().map((n) => n.midi).sort(), [60, 67]);
  const sem = arrangeMotors(job, 2, { method: 'linhas', percussion: false });
  assert.equal(sem.tracks.length, 2);
  assert.ok(sem.roles.every((role) => role !== 'percussão'));
});

test('opção vibrato: a nota leva a curva de afinação e a altura segue a curva no tempo', () => {
  const notes = [[0, 1, 69, 0.8, [0, 0.5, -0.5, 1]]];
  const [plain] = dynamicLines(notes, 1);
  assert.equal(plain[0].bends, undefined, 'desligado por padrão');
  const [line] = dynamicLines(notes, 1, { bends: true });
  assert.equal(bentMidi(line[0], 0.1), 69);
  assert.equal(bentMidi(line[0], 0.3), 69.5);
  assert.equal(bentMidi(line[0], 0.6), 68.5);
  assert.equal(bentMidi(line[0], 0.99), 70);
  // o engine manda ao motor a altura curvada (MIDI fracionário)
  const engine = new Engine();
  const motor = { enabled: true, hold: false };
  engine.motors = [motor];
  Object.assign(engine.transport, { playing: true, start: 0, rate: 1, loop: false, score: { tracks: [line], duration: 2 } });
  assert.equal(engine.command(motor, 0.3).midi, 69.5);
  assert.equal(engine.command(motor, 1.5), null);
});

test('opção volume por importância: linhas extras mais baixas, nunca abaixo de 35%', () => {
  const flat = dynamicLines([[0, 4, 72, 0.8], [0, 2, 48, 0.5]], 2);
  const mixed = dynamicLines([[0, 4, 72, 0.8], [0, 2, 48, 0.5]], 2, { mix: true });
  assert.equal(mixed[0][0].vel, flat[0][0].vel, 'a linha principal não muda');
  assert.ok(mixed[1][0].vel < flat[1][0].vel && mixed[1][0].vel > flat[1][0].vel * 0.35);
  const weak = dynamicLines([[0, 4, 72, 1], [0, 0.1, 48, 0]], 2, { mix: true });
  assert.ok(Math.abs(weak[1][0].vel - 0.4 * 0.35) < 1e-9, 'piso de 35%');
});

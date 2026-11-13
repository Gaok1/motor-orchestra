import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMOS, arrange, arrangeMotors, bentMidi, dynamicLines, mtof, noteAt, parseNote, parseScore, percussionTrack } from '../score.mjs';
import { Engine } from '../engine.mjs';
import { Bells } from '../bells.mjs';
import { DEFAULT_PHYSICS, SIM_DT, rpmFromPulses, stepMotor } from '../physics.mjs';
import { denseOrchestra } from './fixtures/dense-orchestra.mjs';

const run = (P, freq, seconds) => {
  let s = { w: 0 };
  for (let i = 0; i < seconds / SIM_DT; i++) s = stepMotor(s, { freq, vel: 1 }, P, SIM_DT, () => 0.5);
  return s;
};

test('sinos: uma nota sustentada dispara uma vez; repetição e volta do trecho disparam de novo', () => {
  const bells = new Bells(null, null), strikes = [];
  bells.strike = (midi, vel, t) => strikes.push({ midi, t });
  const first = { midi: 69, vel: 0.8 }, repeat = { ...first };
  bells.update(first, 0, 0);
  bells.update(first, 0.1, 0.1);
  bells.update(repeat, 0.2, 0.2);
  bells.update(repeat, 0.3, 0);
  assert.deepEqual(strikes, [{ midi: 69, t: 0 }, { midi: 69, t: 0.2 }, { midi: 69, t: 0.3 }]);
});

test('sinos: vibrato não vira novos golpes e pausa permite repetir a nota', () => {
  const bells = new Bells(null, null), strikes = [];
  bells.strike = (midi) => strikes.push(midi);
  const src = {};
  bells.update({ midi: 69, vel: 0.8, src }, 0, 0);
  bells.update({ midi: 69.2, vel: 0.8, src }, 0.1, 0.1);
  bells.update(null, 0.2, 0.2);
  bells.update({ midi: 69, vel: 0.8, src }, 0.3, 0.3);
  assert.deepEqual(strikes, [69, 69]);
});

test('sinos: segurar nota manual não dispara 250 golpes por segundo', () => {
  const engine = new Engine(), motor = engine.addMotor(69);
  motor.hold = true;
  const bells = new Bells(null, null), strikes = [];
  bells.strike = (midi) => strikes.push(midi);
  for (let t = 0; t < 1; t += SIM_DT) bells.update(engine.command(motor, t), t, null);
  motor.midi = 72;
  bells.update(engine.command(motor, 1), 1, null);
  bells.reset(1);
  bells.update(engine.command(motor, 1.1), 1.1, null);
  assert.deepEqual(strikes, [69, 72, 72]);
});

test('intensidade mínima: 0,15 aceita nota suave e 0,30 a exclui nos três modos', () => {
  const strong = [0, 0.4, 69, 0.6], soft = [0.5, 0.9, 72, 0.2];
  const job = { title: 'Filtro', duration: 1, notes: [strong, soft], density: { alta: [strong, soft] }, drums: [[0.5, 'hat', 0.8]] };
  for (const method of ['papeis', 'linhas', 'melodia']) {
    const options = { method, density: 'alta', percussion: true };
    const low = arrangeMotors(job, 2, { ...options, threshold: 0.15 });
    const high = arrangeMotors(job, 2, { ...options, threshold: 0.3 });
    assert.ok(low.tracks[0].some(n => n.midi === 72), `${method}: perdeu nota suave em 0,15`);
    assert.ok(!high.tracks[0].some(n => n.midi === 72), `${method}: aceitou nota suave em 0,30`);
    assert.deepEqual(low.tracks[1], high.tracks[1], 'filtro tonal alterou percussão');
  }
  assert.deepEqual(job.notes, [strong, soft], 'filtro alterou a transcrição em cache');
});

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

test('linhas dinâmicas: preserva um trinado rápido em um único motor', () => {
  const notes = Array.from({ length: 12 }, (_, i) => [i * 0.06, (i + 1) * 0.06, 69 + i % 2, 0.8]);
  const [line] = dynamicLines(notes, 1);
  assert.equal(line.length, notes.length);
  assert.deepEqual(line.map(n => n.midi), notes.map(n => n[2]));
  assert.ok(noOverlap(line));
});

test('linhas dinâmicas: não perde a continuação após uma sustentação de 14 segundos', () => {
  const [line] = dynamicLines([[0, 14, 60, 0.8], [14, 15, 62, 0.8], [15, 16, 64, 0.8]], 1);
  assert.deepEqual(line.map(n => n.midi), [60, 62, 64]);
});

test('linhas dinâmicas: duplicatas uníssonas deixam motores livres para a harmonia', () => {
  const notes = [[0, 2, 72, 0.8], [0, 2, 72, 0.7], [0, 2, 60, 0.6]];
  const original = structuredClone(notes);
  const tracks = dynamicLines(notes, 2);
  assert.deepEqual(tracks.map(t => t[0].midi), [72, 60]);
  assert.deepEqual(notes, original, 'a transcrição original não é modificada');
});

test('linhas dinâmicas: caudas sobrepostas não duplicam uma nota repetida em dois motores', () => {
  const tracks = dynamicLines([[0, 1.2, 69, 0.8], [0.5, 1.5, 69, 0.8], [0, 1.5, 48, 0.6]], 3);
  const repeated = tracks.flat().filter(n => n.midi === 69).sort((a, b) => a.start - b.start);
  assert.deepEqual(repeated.map(n => n.start), [0, 0.5]);
  assert.equal(repeated[0].end, 0.5);
  assert.equal(repeated[1].reattack, true);
  for (const track of tracks) assert.ok(noOverlap(track));
});

test('linhas dinâmicas: mantém pausas de staccato e entre registros distantes', () => {
  const [short] = dynamicLines([[0, 0.06, 60, 0.8], [0.16, 0.22, 62, 0.8]], 1);
  assert.equal(short[0].end, 0.06);
  const [leap] = dynamicLines([[0, 1, 60, 0.8], [1.1, 2, 72, 0.8]], 1);
  assert.equal(leap[0].end, 1);
});

test('linhas dinâmicas: legato não invade ataque uníssono atribuído a outro motor', () => {
  const tracks = dynamicLines([[0, 0.4, 60, 0.9], [0.5, 1, 62, 0.9], [0.45, 0.8, 60, 0.3]], 3);
  const unisons = tracks.flat().filter(n => n.midi === 60).sort((a, b) => a.start - b.start);
  assert.equal(unisons.length, 2);
  assert.ok(unisons[0].end <= unisons[1].start);
});

test('linhas dinâmicas: cortar cauda preserva a escala de tempo do vibrato', () => {
  const [line] = dynamicLines([[0, 1, 69, 0.8, [0, 0.5, -0.5, 1]], [0.5, 1.5, 69, 0.8]], 1, { bends: true });
  assert.equal(line[0].end, 0.5);
  assert.equal(line[0].span, 1);
  assert.equal(bentMidi(line[0], 0.3), 69.5);
});

test('linhas dinâmicas: eventos inválidos não contaminam a otimização', () => {
  const tracks = dynamicLines([[0, Infinity, 60, 0.8], [0, 1, NaN, 0.8], [1, 0, 60, 0.8], [0, 1, 69, 0.8, []]], 2, { bends: true });
  assert.deepEqual(tracks.map(t => t.map(n => n.midi)), [[69], []]);
  assert.equal(tracks[0][0].bends, undefined);
});

test('equilíbrio: com dois motores preserva o baixo além da linha principal', () => {
  const notes = [[0, 2, 76, 0.9], [0, 2, 64, 0.65], [0, 2, 45, 0.6]];
  assert.deepEqual(dynamicLines(notes, 2, { balance: false }).map(t => t[0].midi), [76, 64]);
  assert.deepEqual(dynamicLines(notes, 2).map(t => t[0].midi), [76, 45]);
  assert.deepEqual(dynamicLines(notes, 3).map(t => t[0].midi), [76, 45, 64]);
});

test('equilíbrio: funciona por intervalo e acompanha a transposição da música', () => {
  const notes = [[0, 2, 76, 0.9], [0, 2, 64, 0.65], [0, 2, 45, 0.6]];
  for (const transpose of [-12, 0, 12, 24]) {
    const shifted = notes.map(([s, e, midi, amp]) => [s, e, midi + transpose, amp]);
    assert.deepEqual(dynamicLines(shifted, 2).map(t => t[0].midi), [76 + transpose, 45 + transpose]);
  }
});

test('equilíbrio: não troca a linha principal nem inventa um papel grave obrigatório', () => {
  const bassFirst = [[0, 2, 45, 0.9], [0, 2, 76, 0.8], [0, 2, 64, 0.5]];
  assert.deepEqual(dynamicLines(bassFirst, 2).map(t => t[0].midi), [45, 76]);
  assert.deepEqual(dynamicLines(bassFirst, 1), dynamicLines(bassFirst, 1, { balance: false }));
  const weakBass = [[0, 2, 76, 0.9], [0, 2, 64, 0.8], [0, 2, 45, 0.1]];
  assert.deepEqual(dynamicLines(weakBass, 2).map(t => t[0].midi), [76, 64]);
});

test('equilíbrio: fora da frase principal escolhe a melhor voz disponível', () => {
  const notes = [[0, 3, 76, 0.9], [0, 3, 40, 0.1], [4, 5, 45, 0.55], [4, 5, 64, 0.65]];
  const tracks = dynamicLines(notes, 2);
  assert.equal(tracks[0].at(-1).midi, 64);
  assert.deepEqual(tracks[0], dynamicLines(notes, 2, { balance: false })[0]);
});

test('equilíbrio: opção chega ao arranjo completo com percussão', () => {
  const data = { title: 'trio', duration: 2, notes: [[0, 2, 76, 0.9], [0, 2, 64, 0.65], [0, 2, 45, 0.6]], drums: [[0, 'kick', 1]] };
  assert.deepEqual(arrangeMotors(data, 3).tracks.slice(0, 2).map(t => t[0].midi), [76, 45]);
  assert.deepEqual(arrangeMotors(data, 3, { balance: false }).tracks.slice(0, 2).map(t => t[0].midi), [76, 64]);
});

test('saliência: distingue detecções fortes mesmo quando os dois volumes saturam', () => {
  const notes = [[0, 2, 60, 0.76], [0, 2, 72, 0.95]];
  assert.equal(dynamicLines(notes, 1, { salience: false })[0][0].midi, 60);
  assert.equal(dynamicLines(notes, 1)[0][0].midi, 72);
});

test('saliência: reduz falsos positivos fracos sem eliminar uma voz suave isolada', () => {
  const notes = [[0, 2, 76, 0.9], [0, 2, 64, 0.65], [0, 2, 45, 0.55]];
  assert.equal(dynamicLines(notes, 2, { salience: false })[1][0].midi, 45);
  assert.equal(dynamicLines(notes, 2)[1][0].midi, 64);
  assert.equal(dynamicLines([[0, 1, 60, 0.1]], 1)[0][0].midi, 60);
});

test('sustentação: um motor livre mantém a nota inteira durante o próximo ataque', () => {
  const notes = [[0, 2, 60, 0.8], [1.5, 4, 62, 0.8]];
  const old = dynamicLines(notes, 2, { sustain: false });
  assert.equal(old[0][0].end, 1.5);
  assert.equal(old[1].length, 0);
  const tracks = dynamicLines(notes, 2);
  assert.equal(tracks.flat().find(n => n.midi === 60).end, 2);
  assert.equal(tracks.flat().find(n => n.midi === 62).start, 1.5);
  assert.equal(tracks.flat().length, 2, 'sem ataque extra ou retomada de cauda');
  for (const track of tracks) assert.ok(noOverlap(track));
});

test('sustentação: não rouba motor ocupado nem desloca o ataque para caber', () => {
  const notes = [[0, 2, 60, 0.8], [1.5, 4, 62, 0.8], [0, 4, 48, 0.5]];
  assert.deepEqual(dynamicLines(notes, 2), dynamicLines(notes, 2, { sustain: false }));
  assert.deepEqual(dynamicLines(notes, 1), dynamicLines(notes, 1, { sustain: false }));
});

test('sustentação: mantém vibrato, volume e duração original ao trocar de motor', () => {
  const notes = [[0, 2, 60, 0.8, [0, 0.5, -0.5, 1]], [1.5, 4, 62, 0.8]];
  const before = dynamicLines(notes, 2, { sustain: false, bends: true, mix: true });
  const after = dynamicLines(notes, 2, { bends: true, mix: true });
  const moved = after.flat().find(n => n.midi === 60);
  assert.equal(moved.start, 0);
  assert.equal(moved.end, 2);
  assert.equal(moved.span, 2);
  assert.equal(moved.vel, before[0][0].vel);
  assert.equal(bentMidi(moved, 1.8), 61);
});

test('sustentação: não atravessa o próximo ataque da mesma altura', () => {
  const notes = [[0, 3, 60, 0.8], [1.5, 4, 62, 0.8], [2, 3, 60, 0.8]];
  const tracks = dynamicLines(notes, 3);
  const repeated = tracks.flat().filter(n => n.midi === 60).sort((a,b) => a.start-b.start);
  assert.equal(repeated.length, 2);
  assert.ok(repeated[0].end <= repeated[1].start);
});

test('saliência: duplicata usa a detecção mais forte antes do limite de volume', () => {
  const notes = [[0, 2, 69, 0.76, [-1, -1]], [0, 2, 69, 0.95, [0.5, 0.5]]];
  const [line] = dynamicLines(notes, 1, { bends: true });
  assert.equal(bentMidi(line[0], 0.5), 69.5);
  assert.equal(line.length, 1);
});

test('arranjo completo: permite isolar saliência e recuperação de caudas', () => {
  const data = { title: 'dueto', duration: 4, notes: [[0, 2, 60, 0.8], [1.5, 4, 62, 0.8]] };
  for (const sustain of [false, true]) {
    for (const salience of [false, true]) {
      const options = { sustain, salience, percussion: false };
      assert.deepEqual(arrangeMotors(data, 2, options).tracks, dynamicLines(data.notes, 2, options));
    }
  }
});

test('redução orquestral: tema suave de doze vozes cabe no primeiro motor', () => {
  const data = denseOrchestra();
  const original = structuredClone(data.notes);
  assert.ok(dynamicLines(data.notes, 4).flat().every(n => n.midi < 74), 'caso que perdia o tema');
  for (const motors of [1, 2, 3, 4, 6, 12]) {
    const tracks = dynamicLines(data.notes, motors, { melody: true });
    assert.deepEqual(tracks[0].map(({ start, end, midi }) => ({ start, end, midi })), data.tracks[0]);
    if (motors > 1) assert.equal(tracks[1][0].midi, 36, 'preserva o fundamento grave');
    for (const track of tracks) assert.ok(noOverlap(track));
  }
  assert.deepEqual(data.notes, original);
});

test('redução orquestral: registro relativo acompanha transposição e nova frase grave', () => {
  for (const shift of [-24, -12, 12, 24]) {
    const data = denseOrchestra(shift);
    const [lead] = dynamicLines(data.notes, 2, { melody: true });
    assert.deepEqual(lead.map(n => n.midi), data.tracks[0].map(n => n.midi));
  }
  const a = denseOrchestra(), b = denseOrchestra(-24);
  const notes = [...a.notes, ...b.notes.map(([s,e,p,v]) => [s+6,e+6,p,v])];
  const [lead] = dynamicLines(notes, 2, { melody: true });
  assert.deepEqual(lead.filter(n => n.start >= 6).map(n => n.midi), b.tracks[0].map(n => n.midi));
});

test('redução orquestral: agudos fracos e cópias de oitava não roubam o tema', () => {
  const data = denseOrchestra();
  const ghosts = data.tracks[0].map(n => [n.start, n.end, n.midi + 24, 0.3]);
  const weak = [[0, 4, 100, 0.08]];
  const [lead] = dynamicLines([...data.notes, ...ghosts, ...weak], 2, { melody: true });
  assert.deepEqual(lead.map(n => n.midi), data.tracks[0].map(n => n.midi));
});

test('redução orquestral: terceiro motor prefere harmonia nova a dobramento', () => {
  const notes = [[0, 2, 76, 0.8], [0, 2, 40, 0.7], [0, 2, 64, 0.65], [0, 2, 67, 0.5]];
  const tracks = dynamicLines(notes, 3, { melody: true });
  assert.deepEqual(tracks.map(t => t[0].midi), [76, 40, 67]);
  assert.ok(dynamicLines(notes, 4, { melody: true }).flat().some(n => n.midi === 64), 'dobramento ainda disponível');
});

test('redução orquestral: recuperação de caudas preserva a primeira linha ao mudar motores', () => {
  const notes = [[0, 2, 76, 0.8, [0, 0.3, -0.3]], [1.5, 4, 78, 0.8], [0, 4, 40, 0.5]];
  const options = { melody: true, bends: true, mix: true };
  const [solo] = dynamicLines(notes, 1, options);
  const tracks = dynamicLines(notes, 4, options);
  assert.deepEqual(tracks[0], solo);
  assert.equal(tracks[0][0].span, 2);
  assert.deepEqual(tracks[0][0].bends, [0, 0.3, -0.3]);
});

test('redução orquestral: não elimina solo suave, notas rápidas nem inventa notas no silêncio', () => {
  assert.deepEqual(dynamicLines([], 2, { melody: true }), [[], []]);
  const notes = Array.from({ length: 12 }, (_, i) => [i * 0.06, (i + 1) * 0.06, 69 + i % 2, 0.15]);
  const [lead] = dynamicLines(notes, 1, { melody: true });
  assert.equal(lead.length, notes.length);
  assert.deepEqual(lead.map(n => n.midi), notes.map(n => n[2]));
});

test('redução orquestral: integra densidade, percussão e fallback sem alterar o cache', () => {
  const data = denseOrchestra();
  const job = { ...data, notes: [], density: { alta: data.notes }, drums: [[0, 'kick', 1]] };
  const score = arrangeMotors(job, 3, { method: 'melodia', density: 'alta', bends: true, mix: true });
  assert.equal(score.tracks.length, 3);
  assert.deepEqual(score.tracks[0].map(n => n.midi), data.tracks[0].map(n => n.midi));
  assert.equal(score.roles[2], 'percussão');
  assert.deepEqual(arrangeMotors(data, 2, { method: 'melodia' }).tracks, dynamicLines(data.notes, 2, { melody: true }));
});

test('redução: harmônicos fracos de ordem 3, 5 e 6 não substituem a melodia', () => {
  for (const offset of [19, 28, 31]) for (const shift of [-12, 0, 12]) {
    const theme = [72, 74, 76, 74, 72, 71, 72, 74].map((p, i) => [i * 0.5, (i + 1) * 0.5, p + shift, 0.55]);
    const ghosts = theme.map(([s, e, p]) => [s, e, p + offset, 0.36]);
    const [lead] = dynamicLines([...theme, ...ghosts, [0, 4, 43 + shift, 0.7]], 1, { melody: true });
    assert.deepEqual(lead.map(n => n.midi), theme.map(n => n[2]));
  }
});

test('redução: picos agudos isolados não picotam uma frase contínua', () => {
  const theme = [72, 74, 76, 74, 72, 71, 72, 74].map((p, i) => [i * 0.5, (i + 1) * 0.5, p, 0.55]);
  const [lead] = dynamicLines([...theme, [0.6, 0.78, 94, 0.55], [2.1, 2.28, 93, 0.55], [0, 4, 43, 0.7]], 1, { melody: true });
  assert.deepEqual(lead.map(n => [n.start, n.end, n.midi]), theme.map(n => n.slice(0, 3)));
});

test('redução: preserva frase aguda suave sobre acompanhamento mais forte', () => {
  for (const duration of [0.06, 0.12, 0.25]) for (const shift of [-12, 0, 12]) {
    const theme = [84, 86, 88, 86, 84, 83, 84, 86]
      .map((p, i) => [i * duration, (i + 1) * duration, p + shift, 0.35]);
    const chords = [[48, 0.85], [60, 0.7], [65, 0.65]];
    for (const repeated of [false, true]) {
      const accompaniment = (repeated ? theme : [[0, 8 * duration]])
        .flatMap(([s, e]) => chords.map(([p, v]) => [s, e, p + shift, v]));
      const [lead] = dynamicLines([...theme, ...accompaniment], 1, { melody: true });
      assert.deepEqual(lead.map(n => n.midi), theme.map(n => n[2]), 'agudos independentes do acorde');
      for (let i = 0; i < lead.length; i++) {
        assert.equal(lead[i].start, theme[i][0]);
        assert.equal(lead[i].end, theme[i][1]);
      }
    }
  }
});

const voiceNotes = () => Array.from({ length: 8 }, (_, i) => [
  [i, i + 1, 60 + i % 3, i % 2 ? 0.4 : 0.9, [0, 0.2, -0.1]],
  [i, i + 1, 72 + i % 3, i % 2 ? 0.9 : 0.4, [0, -0.2, 0.1]],
]).flat();
const selectedNotes = tracks => tracks.flat().map(({ reattack, ...n }) => n)
  .sort((a, b) => a.start - b.start || a.midi - b.midi);
const shortBreaks = tracks => tracks.reduce((sum, track) => sum + track.filter((n, i) => i > 0
  && n.start - track[i - 1].end > 0.03 && n.start - track[i - 1].end < 0.3).length, 0);

test('continuidade: cada motor mantém sua frase quando as intensidades se alternam', () => {
  const notes = voiceNotes(), options = { balance: false, sustain: false, bends: true, mix: true };
  const before = dynamicLines(notes, 2, { ...options, continuity: false });
  const after = dynamicLines(notes, 2, options);
  assert.ok(before[0].some(n => n.midi > 70));
  assert.deepEqual(after[0].map(n => n.midi), [60, 61, 62, 60, 61, 62, 60, 61]);
  assert.deepEqual(after[1].map(n => n.midi), [72, 73, 74, 72, 73, 74, 72, 73]);
  assert.deepEqual(selectedNotes(after), selectedNotes(before), 'preserva ataque, fim, volume e vibrato');
});

test('continuidade: seis motores preservam melodia, pausas e todas as notas selecionadas', () => {
  const notes = [...voiceNotes(), ...voiceNotes().map(([s, e, p, v, c]) => [s + 0.12, e + 0.05, p - 19, v, c]),
    [0, 8, 91, 0.85], [0, 8, 28, 0.7]];
  const original = structuredClone(notes);
  for (const melody of [false, true]) for (const sustain of [false, true]) {
    const options = { melody, sustain, bends: true, mix: true };
    const before = dynamicLines(notes, 6, { ...options, continuity: false });
    const after = dynamicLines(notes, 6, options);
    assert.deepEqual(selectedNotes(after), selectedNotes(before));
    assert.ok(shortBreaks(after) <= shortBreaks(before));
    if (melody) assert.deepEqual(after[0], before[0]);
    for (const track of after) assert.ok(noOverlap(track));
  }
  assert.deepEqual(notes, original);
});

test('continuidade: opção chega ao arranjo completo sem redistribuir a percussão', () => {
  const job = { notes: [], density: { alta: voiceNotes() }, duration: 8, drums: [[0, 'kick', 1]] };
  for (const continuity of [false, true]) {
    const score = arrangeMotors(job, 3, { density: 'alta', continuity });
    assert.deepEqual(score.tracks.slice(0, 2), dynamicLines(job.density.alta, 2, { continuity }));
    assert.equal(score.roles[2], 'percussão');
  }
});

// Contexto em Dó maior: baixo sustentado e uma escala forte de 12 s.
const cMajor = () => [[0, 12, 36, 0.8], ...[60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => [i * 1.5, (i + 1) * 1.5, midi, 0.8])];
const attacksAt = (tracks, t) => tracks.flat().filter(n => n.start === t).map(n => n.midi);

test('harmonia: nota fraca fora do tom perde para a nota fraca do tom', () => {
  const notes = [...cMajor(), [4, 5, 54, 0.32], [4, 5, 52, 0.28]];
  assert.deepEqual(attacksAt(dynamicLines(notes, 3), 4), [54]);
  assert.deepEqual(attacksAt(dynamicLines(notes, 3, { harmony: true }), 4), [52]);
  assert.deepEqual(attacksAt(dynamicLines(notes, 4, { harmony: true }), 4).sort(), [52, 54], 'não elimina a nota');
});

test('harmonia: nota forte ou apoiada pela mesma classe em outra voz não perde valor', () => {
  const strong = [...cMajor(), [4, 5, 54, 0.5], [4, 5, 52, 0.46]];
  assert.deepEqual(attacksAt(dynamicLines(strong, 3, { harmony: true }), 4), [54]);
  const supported = [...cMajor(), [4, 5, 54, 0.32], [4, 5, 52, 0.28], [4, 5, 66, 0.8]];
  assert.deepEqual(attacksAt(dynamicLines(supported, 4, { harmony: true }), 4), [66, 54]);
  const control = [...cMajor(), [4, 5, 54, 0.32], [4, 5, 52, 0.28], [4, 5, 67, 0.8]];
  assert.deepEqual(attacksAt(dynamicLines(control, 4, { harmony: true }), 4), [67, 52]);
});

test('acorde: terceiro motor prefere a terça a um dobramento sem ataque simultâneo', () => {
  const notes = [[0, 2, 79, 0.8], [0, 2, 48, 0.8], [0.3, 2, 67, 0.7], [0.3, 2, 64, 0.6]];
  assert.deepEqual(dynamicLines(notes, 3, { melody: true }).map(t => t[0].midi), [79, 48, 67]);
  assert.deepEqual(dynamicLines(notes, 3, { melody: true, voicing: true }).map(t => t[0].midi), [79, 48, 64]);
});

test('dobrar melodia: motor livre toca a melodia uma oitava abaixo, acima da segunda linha', () => {
  const melody = [72, 74, 76, 77].map((midi, i) => [i * 0.5, (i + 1) * 0.5, midi, 0.8]);
  const notes = [...melody, [0, 2, 48, 0.8], [0.6, 0.8, 59, 0.12]];
  assert.ok(!dynamicLines(notes, 3, { melody: true }).flat().some(n => n.double));
  const tracks = dynamicLines(notes, 3, { melody: true, double: true });
  const copies = tracks.flat().filter(n => n.double);
  assert.deepEqual(copies.map(n => n.midi), [60, 62, 64, 65]);
  for (const copy of copies) {
    assert.ok(tracks[0].some(n => n.start === copy.start && n.midi === copy.midi + 12 && copy.vel < n.vel));
  }
  for (const track of tracks) assert.ok(noOverlap(track));
  const high = dynamicLines([...melody, [0, 2, 62, 0.8]], 3, { melody: true, double: true });
  assert.deepEqual(high.flat().filter(n => n.double).map(n => n.midi), [64, 65], 'não desce até a segunda linha');
  assert.deepEqual(arrangeMotors({ notes, duration: 2 }, 3, { method: 'melodia', double: true }).tracks, tracks);
});

test('dobrar melodia: legato da cópia não atravessa a mesma altura em outro motor', () => {
  // A cópia Lá3 seguiria em legato até 0,56 s, por cima do Lá3 da segunda linha.
  const notes = [[0, 0.5, 69, 0.8], [0.56, 1, 74, 0.8], [0, 0.5, 45, 0.8], [0.55, 1, 57, 0.8]];
  const tracks = dynamicLines(notes, 3, { melody: true, double: true });
  const copy = tracks[2].find(n => n.double && n.midi === 57);
  assert.ok(copy && tracks[1].some(n => n.midi === 57 && n.start === 0.55));
  assert.equal(copy.end, 0.55);
});

test('trecho selecionado: começa no início, repete só ele e para no fim sem repetir', () => {
  const engine = new Engine();
  engine.ctx = { currentTime: 100 }; // relógio falso; sem motores não há áudio a agendar
  const score = { tracks: [[]], duration: 30 };
  engine.transport.region = { start: 10, end: 14 };
  engine.play(score, { from: 2 }); // fora do trecho: começa no início dele
  const t0 = engine.transport.start;
  assert.ok(Math.abs(engine.songTimeAt(t0 + 10) - 10) < 1e-9);
  assert.ok(Math.abs(engine.songTimeAt(t0 + 13.5) - 13.5) < 1e-9);
  assert.ok(Math.abs(engine.songTimeAt(t0 + 15) - 11) < 1e-9);
  assert.ok(Math.abs(engine.songTimeAt(t0 + 21) - 13) < 1e-9);
  engine.transport.loop = false;
  assert.equal(engine.songTimeAt(t0 + 14.01), null);

  // Trecho que passa do fim da partitura é limitado à duração; trecho inválido = música inteira.
  engine.transport.region = { start: 20, end: 99 };
  assert.deepEqual(engine.bounds(), [20, 30]);
  engine.transport.region = { start: 40, end: 50 };
  assert.deepEqual(engine.bounds(), [0, 30]);
});

test('mudar o trecho tocando: segue de onde está se couber, senão pula para o início', () => {
  const engine = new Engine();
  engine.ctx = { currentTime: 0 };
  engine.play({ tracks: [[]], duration: 30 });
  engine.ctx.currentTime = engine.transport.start + 12;
  engine.setRegion({ start: 10, end: 20 });
  assert.ok(Math.abs(engine.songTime() - 12) < 1e-9);
  engine.setRegion({ start: 2, end: 5 });
  assert.ok(Math.abs(engine.songTime() - 2) < 0.06); // play agenda o início 50 ms à frente
  engine.ctx.currentTime += 3.5;
  engine.setRegion(null);
  assert.ok(engine.songTime() > 2 && engine.songTime() < 5);
});

// Partituras da orquestra: afinação, demonstrações e arranjo da transcrição em vozes.
// Uma partitura é { title, duration, tracks }, onde tracks[i] é a voz do motor i:
// lista ordenada de { midi, start, end, vel } sem sobreposição (um motor = uma nota).

const NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];

export const mtof = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const noteName = (midi) => { const m = Math.round(midi); return `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`; };

// Nota tocada pela voz no instante t (segundos de partitura), ou null.
export function noteAt(track, t) {
  let lo = 0, hi = track.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, note = track[mid];
    if (t < note.start) hi = mid - 1;
    else if (t >= note.end) lo = mid + 1;
    else return note;
  }
  return null;
}

// Partitura em texto: uma linha por motor. Tokens: `A4`, `C#5:0.5` (nota:tempos),
// `-` ou `-:2` (pausa), `@0.5` (duração padrão), `v0.6` (intensidade), `|` (barra, ignorada).
// Linhas que começam com `#` são comentários.
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTALS = { '': 0, '#': 1, '♯': 1, b: -1, '♭': -1 };

export function parseNote(token) {
  const match = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(token);
  if (!match) return null;
  const midi = (Number(match[3]) + 1) * 12 + LETTERS[match[1].toUpperCase()] + ACCIDENTALS[match[2]];
  return midi >= 0 && midi <= 127 ? midi : null;
}

export function parseScore(text, bpm) {
  const beat = 60 / bpm, gap = 0.08;
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const tracks = lines.map((source, row) => {
    let t = 0, unit = 1, vel = 0.85;
    const notes = [];
    for (const token of source.split(/\s+/)) {
      if (token === '|') continue;
      if (/^@[\d.]+$/.test(token)) { unit = Number(token.slice(1)); continue; }
      if (/^v[\d.]+$/.test(token)) { vel = Math.min(1, Number(token.slice(1))); continue; }
      const [head, beats = String(unit)] = token.split(':');
      const dur = Number(beats) * beat;
      if (!(dur > 0)) throw new Error(`Motor ${row + 1}: duração inválida em “${token}”.`);
      if (head !== '-') {
        const midi = parseNote(head);
        if (midi === null) throw new Error(`Motor ${row + 1}: nota inválida “${head}” (use A4, C#5, Bb3...).`);
        notes.push({ midi, start: t, end: t + dur * (1 - gap), vel });
      }
      t += dur;
    }
    return notes;
  });
  return { tracks, duration: Math.max(0, ...tracks.flat().map((n) => n.end)) + 0.3 };
}

export const DEMOS = {
  scale: {
    title: 'Escala de Lá maior (sobe e desce)', bpm: 150,
    text: 'A4 B4 C#5 D5 E5 F#5 G#5 A5 | G#5 F#5 E5 D5 C#5 B4 A4:2',
  },
  chords: {
    title: 'Acordes I–V–vi–IV em Lá maior', bpm: 120,
    text: [
      '@4 A4 G#4 A4 A4 | A4 G#4 A4 A4 | A4:6',
      '@4 C#5 B4 C#5 D5 | C#5 B4 C#5 D5 | C#5:6',
      '@4 E5 E5 F#5 F#5 | E5 E5 F#5 F#5 | E5:6',
      'v1 @4 A2 E2 F#2 D2 | A2 E2 F#2 D2 | A2:6',
    ].join('\n'),
  },
  original: {
    title: 'Engrenagens (composição original)', bpm: 132,
    text: [
      '# melodia',
      'v0.95 E5 A5 G5:.5 E5:.5 C5 | D5:1.5 C5:.5 A4:2 | E5 G5 C6 B5:.5 A5:.5 | B5:2 G5 D5 | A5:.5 G5:.5 E5 A5 C6 | A5:1.5 G5:.5 F5 E5 | D5 G5 B5 D6 | A5:4',
      '# arpejo',
      'v0.6 @.5 A3 C4 E4 C4 A3 C4 E4 C4 | F3 A3 C4 A3 F3 A3 C4 A3 | G3 C4 E4 C4 G3 C4 E4 C4 | G3 B3 D4 B3 G3 B3 D4 B3 | A3 C4 E4 C4 A3 C4 E4 C4 | F3 A3 C4 A3 F3 A3 C4 A3 | G3 B3 D4 B3 G3 B3 D4 B3 | A3:4',
      '# baixo',
      'v0.9 A2 A3 A2 E3 | F2 F3 F2 C3 | C3 C4 C3 G3 | G2 G3 G2 D3 | A2 A3 A2 E3 | F2 F3 F2 C3 | G2 G3 G2 D3 | A2:4',
      '# sustentação',
      'v0.5 @4 C5 | A4 | G4 | B4 | C5 | A4 | B4 | A4',
    ].join('\n'),
  },
};

// ---------- Arranjo de uma transcrição para N motores ----------
// `job.notes` vem do transcritor: [início, fim, midi, intensidade 0..1].
// Papéis, como num arranjo para floppies (Moppy): motor 1 = melodia, último = baixo,
// os do meio = harmonia. Cada motor toca uma nota por vez.

export const MELODY_RANGE = [52, 90];  // Mi3 a Fá♯6
export const BASS_TOP = 55;           // até Sol3
const MIN_FRAGMENT = 0.05;            // trechos menores que isso viram ruído
const REATTACK = 0.03;                // notas da mesma altura a menos disso viram re-ataque sem parar o motor
// O transcritor acerta o ataque (~3 ms) mas erra o fim das notas em até ~100 ms; sem
// este bônus, a cauda da nota anterior ainda "ganha" da nota que acabou de entrar.
const FRESH_BONUS = 12, FRESH_WINDOW = 0.25;

// Extrai uma linha monofônica: em cada intervalo entre bordas de notas, fica a nota
// ativa de maior `rank`. Notas usadas saem de `used`, para não tocarem duas vezes.
function extractLine(notes, rank, eligible, used) {
  const pool = notes.filter((n) => !used.has(n) && eligible(n)).sort((a, b) => a.start - b.start);
  const times = [...new Set(pool.flatMap((n) => [n.start, n.end]))].sort((a, b) => a - b);
  const pieces = [];
  let active = [], next = 0;
  for (let k = 0; k < times.length - 1; k++) {
    const t = times[k];
    while (next < pool.length && pool[next].start <= t) active.push(pool[next++]);
    active = active.filter((n) => n.end > t);
    if (!active.length) continue;
    const best = active.reduce((a, b) => (rank(b, t) > rank(a, t) ? b : a));
    const last = pieces.at(-1);
    if (last && last.note === best && last.end === t) last.end = times[k + 1];
    else pieces.push({ note: best, start: t, end: times[k + 1] });
  }
  const line = [];
  for (const piece of pieces) {
    if (piece.end - piece.start < MIN_FRAGMENT) continue;
    used.add(piece.note);
    line.push({ midi: piece.note.midi, start: piece.start, end: piece.end, vel: piece.note.vel });
  }
  return line;
}

// Harmonia: notas restantes, em ordem de ataque, para o motor livre de nota mais
// próxima. Sem motor livre, rouba o que já soou por mais tempo (o ataque novo
// importa mais que a cauda de uma nota longa).
function fillHarmony(notes, count, busy) {
  const tracks = Array.from({ length: count }, () => []);
  if (!count) return tracks;
  const sounding = (midi, t) => busy.some((track) => track.some((n) => n.midi === midi && n.start <= t && n.end > t));
  for (const note of notes.slice().sort((a, b) => a.start - b.start || b.vel - a.vel)) {
    if (sounding(note.midi, note.start + 0.01)) continue; // já está na melodia ou no baixo
    let best = -1, cost = Infinity;
    tracks.forEach((track, m) => {
      const last = track.at(-1);
      if (last && last.end > note.start) return;
      const c = last ? Math.abs(last.midi - note.midi) : 0;
      if (c < cost) { best = m; cost = c; }
    });
    if (best < 0) {
      let oldest = Infinity;
      tracks.forEach((track, m) => {
        const last = track.at(-1);
        if (note.start - last.start >= 0.12 && note.vel >= last.vel * 0.7 && last.start < oldest) { best = m; oldest = last.start; }
      });
      if (best < 0) continue;
      tracks[best].at(-1).end = note.start;
    }
    tracks[best].push({ midi: note.midi, start: note.start, end: note.end, vel: note.vel });
  }
  return tracks;
}

// Garante uma nota por vez por motor. Nota repetida colada vira re-ataque: o motor não para (parar
// e reacelerar soa como um "vai e volta" na altura); o engine só dá uma piscada no volume.
function articulate(track) {
  track.sort((a, b) => a.start - b.start);
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    a.end = Math.min(a.end, b.start);
    if (a.midi === b.midi && b.start - a.end < REATTACK) {
      a.end = b.start;
      b.reattack = true;
    }
  }
  return track.filter((n) => n.end - n.start >= 0.03);
}

export function arrange(job, motors, { threshold = 0.3 } = {}) {
  const notes = job.notes
    .filter(([, , , amp]) => amp >= threshold)
    .map(([start, end, midi, amp]) => ({ start, end, midi, vel: Math.min(1, 0.4 + 0.8 * amp) }));
  const used = new Set();
  const fresh = (n, t) => (t - n.start < FRESH_WINDOW ? FRESH_BONUS : 0);
  const melody = motors >= 1
    ? extractLine(notes, (n, t) => n.midi + 18 * n.vel + fresh(n, t), (n) => n.midi >= MELODY_RANGE[0] && n.midi <= MELODY_RANGE[1], used) : [];
  const bass = motors >= 2 ? extractLine(notes, (n, t) => -n.midi + 10 * n.vel + fresh(n, t), (n) => n.midi <= BASS_TOP, used) : [];
  const harmony = fillHarmony(notes.filter((n) => !used.has(n)), Math.max(0, motors - 2), [melody, bass]);
  const tracks = [melody, ...harmony, ...(motors >= 2 ? [bass] : [])].slice(0, motors).map(articulate);
  const roles = tracks.map((_, i) => (i === 0 ? 'melodia' : motors >= 2 && i === motors - 1 ? 'baixo' : 'harmonia'));
  return { title: job.title, tracks, roles, duration: job.duration };
}

// ---------- Linhas dinâmicas ----------
// Sem papéis fixos: o motor 1 pega a cadeia de notas de maior valor na música inteira, o motor 2
// a melhor cadeia entre as notas que sobraram, e assim por diante. O valor de uma cadeia é
// intensidade × tempo tocado, menos custos de salto grande e de interromper uma nota que ainda
// soaria (programação dinâmica sobre as notas). Cada ataque do motor é um ataque real da música.

const LINE = {
  base: 1, velW: 2,             // valor por segundo: base + velW·(intensidade − 0,7)
  tail: 0.1,                    // o transcritor erra o fim em até ~100 ms: cortar até aí é livre
  intC: 0.25, intK: 1,          // custo de interromper: fixo + por segundo que ainda soaria
  jumpC: 0.4, jump0: 7,         // custo por oitava de salto além de uma quinta
  phrase: 0.5,                  // depois de 0,5 s de silêncio, a frase recomeça sem custos
  noteC: 0.02, minPlay: 0.08,   // custo por ataque; a nota interrompida soa pelo menos 80 ms
  window: 12,                   // só olha 12 s para trás (desempenho)
};
const LEGATO = 0.12;            // buracos menores que isso na linha são preenchidos

function bestChain(pool) {
  const p = LINE, N = pool.length;
  if (!N) return { chain: [], total: 0 };
  const rate = pool.map((n) => Math.max(0.05, p.base + p.velW * (n.vel - 0.7)));
  const F = new Float64Array(N), from = new Int32Array(N).fill(-1);
  const byEnd = [...pool.keys()].sort((a, b) => pool[a].end - pool[b].end);
  let ptr = 0, closedBest = 0, closedArg = -1;
  for (let j = 0; j < N; j++) {
    const nj = pool[j];
    // cadeias cuja última nota acabou há mais de `phrase` s: sem custo de transição
    while (ptr < N && pool[byEnd[ptr]].end + p.phrase <= nj.start) {
      const i = byEnd[ptr++];
      const v = F[i] + rate[i] * (pool[i].end - pool[i].start);
      if (v > closedBest) { closedBest = v; closedArg = i; }
    }
    let best = closedBest, arg = closedArg;
    for (let i = j - 1; i >= 0; i--) {
      const ni = pool[i];
      if (nj.start - ni.start > p.window) break;
      if (ni.end + p.phrase <= nj.start || nj.start - ni.start < p.minPlay) continue;
      let v = F[i] + rate[i] * (Math.min(ni.end, nj.start) - ni.start) - p.noteC;
      const rest = ni.end - nj.start;
      if (rest > p.tail) v -= p.intC + p.intK * (rest - p.tail);
      const leap = Math.abs(ni.midi - nj.midi);
      if (leap > p.jump0) v -= (p.jumpC * (leap - p.jump0)) / 12;
      if (v > best) { best = v; arg = i; }
    }
    F[j] = best;
    from[j] = arg;
  }
  let end = -1, total = 0;
  for (let j = 0; j < N; j++) {
    const v = F[j] + rate[j] * (pool[j].end - pool[j].start);
    if (v > total) { total = v; end = j; }
  }
  const chain = [];
  for (let j = end; j >= 0; j = from[j]) chain.push(pool[j]);
  return { chain: chain.reverse(), total };
}

// Opções (desligadas por padrão):
//   bends: a nota segue a curva fina de afinação do transcritor (vibrato, deslizes); o motor não
//          está preso a semitons. A curva vale para a duração original da nota (span).
//   mix:   cada linha extra toca mais baixo, na proporção da raiz do valor dela em relação à
//          linha 1, para a textura não embolar a melodia (mínimo 35%).
export function dynamicLines(notes, motors, { bends = false, mix = false } = {}) {
  let pool = notes.map(([start, end, midi, amp, curve]) => ({ start, end, midi, vel: Math.min(1, 0.4 + 0.8 * amp), curve }))
    .sort((a, b) => a.start - b.start || b.vel - a.vel);
  const tracks = [];
  let first = 0;
  for (let m = 0; m < motors; m++) {
    const { chain, total } = bestChain(pool);
    if (m === 0) first = total;
    const gain = mix && first > 0 ? Math.min(1, Math.max(0.35, Math.sqrt(total / first))) : 1;
    const used = new Set(chain);
    pool = pool.filter((n) => !used.has(n));
    const line = chain.map((n, k) => {
      const note = { midi: n.midi, start: n.start, end: chain[k + 1] ? Math.min(n.end, chain[k + 1].start) : n.end, vel: n.vel * gain };
      if (bends && n.curve) Object.assign(note, { bends: n.curve, span: n.end - n.start });
      return note;
    });
    for (let k = 0; k < line.length - 1; k++) {
      const gap = line[k + 1].start - line[k].end;
      if (gap > 0 && gap <= LEGATO) line[k].end = line[k + 1].start;
    }
    tracks.push(articulate(line));
  }
  return tracks;
}

// Altura (MIDI fracionário) de uma nota com curva de afinação no instante t da partitura.
export function bentMidi(note, t) {
  const b = note.bends;
  const k = Math.floor(((t - note.start) / note.span) * b.length);
  return note.midi + b[Math.min(b.length - 1, Math.max(0, k))];
}

// Percussão num motor: golpes curtos; em golpes quase simultâneos fica o de maior prioridade.
// Altura, duração e ruído de cada peça foram escolhidos de ouvido para o modelo mecânico.
export const DRUM_VOICE = {
  kick: { midi: 33, dur: 0.07, noise: 0.1, gain: 1 },     // Lá1 (55 Hz): baque grave
  snare: { midi: 50, dur: 0.05, noise: 0.7, gain: 0.9 },  // Ré3 + ruído
  hat: { midi: 93, dur: 0.02, noise: 0.8, gain: 0.45 },   // Lá6 curtíssimo + ruído
};
const DRUM_PRIORITY = { kick: 3, snare: 2, hat: 1 };

export function percussionTrack(drums) {
  const out = [];
  for (const [t, kind, strength] of drums) {
    const prev = out.at(-1);
    if (prev && t - prev.start < 0.04) {
      if (DRUM_PRIORITY[kind] <= DRUM_PRIORITY[prev.kind]) continue;
      out.pop();
    }
    const v = DRUM_VOICE[kind];
    out.push({ midi: v.midi, start: t, end: t + v.dur, vel: v.gain * (0.5 + 0.5 * strength), noise: v.noise, kind });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].end = Math.min(out[i].end, out[i + 1].start - 0.005);
  return out;
}

// Arranjo completo para N motores. Métodos: 'linhas' (linhas dinâmicas sobre as notas do
// basic-pitch, na densidade escolhida) e 'papeis' (melodia/harmonia/baixo). Com percussão, o
// último motor vira percussão.
export function arrangeMotors(job, motors, { method = 'linhas', density = 'media', percussion = true, threshold, bends = false, mix = false } = {}) {
  const drums = percussion && motors >= 2 && job.drums?.length ? job.drums : null;
  const tonal = drums ? motors - 1 : motors;
  let tracks, roles;
  if (method === 'linhas') {
    tracks = dynamicLines(job.density?.[density] ?? job.notes, tonal, { bends, mix });
    roles = tracks.map(() => '');
  } else {
    ({ tracks, roles } = arrange(job, tonal, { threshold }));
  }
  if (drums) { tracks = [...tracks, percussionTrack(drums)]; roles = [...roles, 'percussão']; }
  return { title: job.title, tracks, roles, duration: job.duration };
}

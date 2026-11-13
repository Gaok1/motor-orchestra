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
  noteC: 0.02, minPlay: 0.08,   // antes de interromper uma nota longa, deixa tocar 80 ms
};
const LEGATO = 0.12;            // buracos menores que isso na linha são preenchidos

// Um harmônico pode decair antes da fundamental ou unir dois re-ataques dela.
// A evidência é o ataque próximo e a cobertura da mesma altura, não fins iguais.
function harmonicCoverage(upper, interval, notes) {
  let aligned = false, covered = 0;
  for (const lower of notes) {
    if (lower.midi !== upper.midi - interval || lower.strength <= upper.strength * 1.1) continue;
    aligned ||= Math.abs(lower.start - upper.start) <= 0.06;
    covered += Math.max(0, Math.min(lower.end, upper.end) - Math.max(lower.start, upper.start));
  }
  return aligned ? Math.min(1, covered / (upper.end - upper.start)) : 0;
}

function bestChain(pool, priority = () => 1, p = LINE) {
  const N = pool.length;
  if (!N) return { chain: [], total: 0 };
  const rate = pool.map((n) => n.weight * priority(n));
  const F = new Float64Array(N), from = new Int32Array(N).fill(-1);
  const byEnd = [...pool.keys()].sort((a, b) => pool[a].end - pool[b].end);
  const active = new Set();
  let ptr = 0, closedBest = 0, closedArg = -1;
  for (let j = 0; j < N; j++) {
    const nj = pool[j];
    // cadeias cuja última nota acabou há mais de `phrase` s: sem custo de transição
    while (ptr < N && pool[byEnd[ptr]].end + p.phrase <= nj.start) {
      const i = byEnd[ptr++];
      active.delete(i);
      const v = F[i] + rate[i] * (pool[i].end - pool[i].start);
      if (v > closedBest) { closedBest = v; closedArg = i; }
    }
    let best = closedBest, arg = closedArg;
    // Só notas ainda próximas da frase; sustentações longas não desaparecem
    // por causa de uma janela fixa medida a partir do ataque.
    for (const i of active) {
      const ni = pool[i];
      // Uma nota curta completa pode levar à próxima: 80 ms é proteção contra
      // cortes prematuros, não um limite de andamento para trinados/arpejos.
      const minPlay = Math.min(p.minPlay, ni.end - ni.start);
      if (nj.start - ni.start + 1e-9 < minPlay) continue;
      let v = F[i] + rate[i] * (Math.min(ni.end, nj.start) - ni.start) - p.noteC;
      const rest = ni.end - nj.start;
      if (rest > p.tail) v -= p.intC + p.intK * (rest - p.tail);
      const leap = Math.abs(ni.midi - nj.midi);
      if (leap > p.jump0) v -= (p.jumpC * (leap - p.jump0)) / 12;
      if (v > best) { best = v; arg = i; }
    }
    F[j] = best;
    from[j] = arg;
    active.add(j);
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

// Registro relativo à textura local, sem faixa MIDI fixa. Só vizinhas com
// evidência suficiente votam: um harmônico agudo muito fraco não define o topo.
// A janela acompanha mudanças de registro e considera notas longas ainda ativas.
function melodyPriorities(pool) {
  const priorities = new Map(), active = new Set();
  let next = 0;
  for (const n of pool) {
    const t = n.start;
    while (next < pool.length && pool[next].start <= t + 0.5) active.add(pool[next++]);
    for (const other of active) if (other.end < t - 0.5) active.delete(other);
    let strongest = 0;
    for (const other of active) strongest = Math.max(strongest, other.strength);
    const floor = Math.max(0.18, strongest * 0.5);
    let below = 0, total = 0, pitchSum = 0, harmonicShadow = 1;
    let previous = 0, following = 0, competing = false;
    let prevNote = null, nextNote = null;
    for (const other of active) {
      if (other === n || other.strength < Math.max(0.12, n.strength * 0.6)) continue;
      const proximity = Math.max(0, 1 - Math.abs(n.midi - other.midi) / 7);
      if (other.start < n.start && Math.abs(other.end - n.start) <= 0.18 && proximity > previous) {
        previous = proximity;
        prevNote = other;
      }
      if (other.start > n.start && Math.abs(other.start - n.end) <= 0.18 && proximity > following) {
        following = proximity;
        nextNote = other;
      }
    }
    const relations = new Map();
    const relation = interval => {
      if (!relations.has(interval)) {
        const neighbors = [prevNote, nextNote].filter(Boolean);
        const paired = neighbor => harmonicCoverage(neighbor, interval, active) >= 0.7;
        relations.set(interval, {
          independent: neighbors.some(neighbor => !paired(neighbor)),
          parallel: neighbors.some(neighbor => neighbor.midi !== n.midi && paired(neighbor)),
        });
      }
      return relations.get(interval);
    };
    for (const other of active) {
      const interval = n.midi - other.midi;
      const octave = interval >= 12 && interval % 12 === 0;
      const overlap = Math.max(0, Math.min(n.end, other.end) - Math.max(n.start, other.start));
      const overtoneInterval = [19, 28, 31].includes(interval);
      const coverage = overtoneInterval ? harmonicCoverage(n, interval, active) : 0;
      // 3º, 5º e 6º harmônicos arredondados ao semitom. Exige coincidência
      // de ataques. Caudas diferentes também são aceitas se a frase vizinha
      // acompanha a mesma fundamental: o harmônico pode decair antes dela.
      const overtone = overtoneInterval && n.strength < other.strength * 0.75
        && Math.abs(other.start - n.start) <= 0.06
        && (Math.abs(other.end - n.end) <= 0.08 || coverage >= 0.7
          && relation(interval).parallel && !relation(interval).independent);
      if ((octave || overtone) && other.strength > n.strength * 1.1
          && Math.abs(other.start - n.start) <= 0.25 && Math.abs(other.end - n.end) <= 0.25) {
        // Coincidir com um harmônico numa nota do acorde não torna a frase
        // inteira um harmônico. Se a vizinha aguda se move independentemente
        // da voz grave, conserva a nota na linha melódica.
        const { independent } = relation(interval);
        // Uma cópia mais fraca, com ataque e fim próximos, pode ser um harmônico
        // do transcritor ou um dobramento. Prefere a oitava com mais evidência.
        if (!independent) harmonicShadow = Math.min(harmonicShadow, 1 - (overtone ? 0.97 * coverage : 0.85 * overlap / (n.end - n.start)));
      }
      if (other !== n && other.strength >= floor && other.start <= n.start && other.end >= n.end && interval > 7) competing = true;
      if (other.strength < floor) continue;
      const evidence = other.strength * Math.min(1, other.end - other.start);
      total += evidence;
      pitchSum += evidence * other.midi;
      if (other.midi < n.midi) below += evidence;
      else if (other.midi === n.midi) below += evidence * 0.5;
    }
    const rank = total ? below / total : 0.5;
    const center = total ? pitchSum / total : n.midi;
    // Só o percentil comprime as distâncias num acorde muito cheio: a melodia
    // uma oitava acima precisa se distinguir da nota superior da sustentação.
    const register = 2 ** Math.max(-2, Math.min(2, (n.midi - center) / 12));
    const reliable = Math.min(1, n.strength / floor);
    // O acompanhamento forte não pode fazer uma frase aguda suave parecer
    // vários picos isolados. Vizinhas de intensidade semelhante sustentam a
    // evidência da frase, mesmo abaixo do piso usado para estimar o registro.
    const support = Math.max(previous, following);
    let phraseStrength = n.strength;
    for (const other of active) if (Math.abs(other.midi - n.midi) <= 7) {
      phraseStrength = Math.max(phraseStrength, other.strength);
    }
    const phraseConfidence = Math.min(1, n.strength / Math.max(0.18, phraseStrength * 0.5));
    const confidence = reliable ** 4 * (1 - support) + phraseConfidence * support;
    // Um pico agudo curto isolado não deve cortar uma frase sustentada.
    // Uma sequência rápida com vizinhas próximas conserva sua prioridade.
    const continuity = competing && n.end - n.start < 0.3 ? 0.15 + 0.85 * support : 1;
    priorities.set(n, (0.15 + 3.85 * rank ** 3 * register * confidence) * harmonicShadow * continuity);
  }
  return priorities;
}

// Dobramentos em oitavas com o mesmo ataque têm menos valor depois de já
// representados. Não apaga notas nem penaliza uma linha independente só por
// compartilhar a classe de altura. O baixo continua concorrendo sem esse desconto.
function octaveRedundancy(note, tracks) {
  let overlap = 0;
  for (const track of tracks) {
    let lo = 0, hi = track.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (track[mid].start < note.start - 0.08) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < track.length && track[i].start <= note.start + 0.08; i++) {
      const sounding = track[i];
      if (sounding.midi === note.midi || (sounding.midi - note.midi) % 12 !== 0) continue;
      overlap = Math.max(overlap, Math.max(0, Math.min(sounding.end, note.end)
        - Math.max(sounding.start, note.start)) / (note.end - note.start));
    }
  }
  return 1 - 0.65 * overlap;
}

// Notas da linha que soam entre `start` e `end`. As notas de uma linha não se
// sobrepõem, então os fins também estão em ordem crescente.
function overlapping(track, start, end) {
  let lo = 0, hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = lo; i < track.length && track[i].start < end; i++) out.push(track[i]);
  return out;
}

// Acompanhamento pela função no acorde: a classe de altura que já soa em outra
// linha vale o mesmo que um dobramento (35%), durante a sobreposição, mesmo
// sem ataque simultâneo. O trecho novo ganha mais se for terça ou sétima acima
// da voz mais grave, que definem o acorde; a quinta e o uníssono não ganham.
function chordRole(note, tracks) {
  const spans = [], mid = (note.start + note.end) / 2;
  let bass = null;
  for (const track of tracks) for (const other of overlapping(track, note.start, note.end)) {
    if ((other.midi - note.midi) % 12 === 0) spans.push([Math.max(other.start, note.start), Math.min(other.end, note.end)]);
    if (other.start <= mid && other.end > mid && (!bass || other.midi < bass.midi)) bass = other;
  }
  spans.sort((a, b) => a[0] - b[0]);
  let covered = 0, from = note.start, to = note.start;
  for (const [a, b] of spans) {
    if (a > to) { covered += to - from; from = a; to = b; }
    else to = Math.max(to, b);
  }
  covered = (covered + to - from) / (note.end - note.start);
  const interval = bass ? (((note.midi - bass.midi) % 12) + 12) % 12 : null;
  const bonus = interval === null || interval === 0 || interval === 7 ? 0 : [3, 4, 10, 11].includes(interval) ? 0.3 : 0.15;
  return 0.35 * covered + (1 - covered) * (1 + bonus);
}

// Perfis de tonalidade de Krumhansl-Kessler, em Dó. A escala menor inclui a
// sensível da menor harmônica.
const KEY_PROFILES = [
  { profile: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], scale: [0, 2, 4, 5, 7, 9, 11] },
  { profile: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17], scale: [0, 2, 3, 5, 7, 8, 10, 11] },
];
const KEY_BLOCK = 4, KEY_SUPPORT = 0.25;

function correlation(a, b) {
  const ma = a.reduce((s, x) => s + x) / a.length, mb = b.reduce((s, x) => s + x) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// Classes de altura da tonalidade que melhor explica o croma, ou null sem notas.
function keyScale(chroma) {
  if (!chroma.some(x => x > 1e-9)) return null;
  let best = -Infinity, scale = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = chroma.map((_, i) => chroma[(i + tonic) % 12]);
    for (const key of KEY_PROFILES) {
      const r = correlation(key.profile, rotated);
      if (r > best) { best = r; scale = key.scale.map(d => (d + tonic) % 12); }
    }
  }
  return new Set(scale);
}

// Notas fracas fora da tonalidade local costumam ser harmônicos, vazamento da
// bateria ou erros do transcritor. Na seleção valem até 50% menos; volume e
// afinação não mudam. A tonalidade vem de blocos de 4 s numa janela de 12 s,
// com as notas fortes pesando mais. Uma nota forte da mesma classe de altura
// por perto (acorde emprestado, cromatismo em outra voz) retira a penalidade.
// Notas a partir de 0,45 de intensidade nunca perdem valor.
function harmonicFit(pool) {
  const fit = new Map(), scales = [], chroma = Array(12).fill(0);
  const evidence = n => n.strength ** 2 * Math.min(2, n.end - n.start);
  const last = pool.reduce((t, n) => Math.max(t, n.start), 0);
  let lo = 0, hi = 0;
  for (let w = 0; w <= last; w += KEY_BLOCK) {
    while (hi < pool.length && pool[hi].start < w + 2 * KEY_BLOCK) chroma[pool[hi].midi % 12] += evidence(pool[hi++]);
    while (lo < hi && pool[lo].start < w - KEY_BLOCK) chroma[pool[lo].midi % 12] -= evidence(pool[lo++]);
    scales.push(keyScale(chroma));
  }
  const strong = Array.from({ length: 12 }, () => []);
  for (const n of pool) if (n.strength >= 0.45) strong[n.midi % 12].push(n);
  for (const n of pool) {
    const weakness = Math.max(0, Math.min(1, (0.45 - n.strength) / 0.15));
    const scale = scales[Math.floor(n.start / KEY_BLOCK)];
    if (!weakness || !scale || scale.has(n.midi % 12)) continue;
    if (strong[n.midi % 12].some(o => o.start < n.end + KEY_SUPPORT && o.end > n.start - KEY_SUPPORT)) continue;
    fit.set(n, 1 - 0.5 * weakness);
  }
  return fit;
}

// Cópias da melodia uma oitava abaixo concorrem com as notas restantes a partir
// da terceira linha, valendo uma fração da nota original: um motor de
// acompanhamento dobra a melodia em vez de tocar notas fracas. Com driver sem
// controle de corrente (A4988), o volume da melodia vem do número de motores.
// A cópia fica acima da segunda linha e não coincide com nenhuma nota preparada
// de mesma altura, já escolhida ou não, na duração original: a recuperação de
// sustentações pode devolver a cauda inteira a uma nota cortada.
const DOUBLE_VALUE = 0.7, DOUBLE_FLOOR = 36, DOUBLE_GAIN = 0.8;
function melodyDoubles(leadChain, second, notes) {
  const byPitch = new Map();
  for (const n of notes) {
    if (!byPitch.has(n.midi)) byPitch.set(n.midi, []);
    byPitch.get(n.midi).push(n);
  }
  const copies = leadChain.flatMap((n, k) => {
    const midi = n.midi - 12, end = leadChain[k + 1] ? Math.min(n.end, leadChain[k + 1].start) : n.end;
    if (midi < DOUBLE_FLOOR || end - n.start < 0.03) return [];
    if (overlapping(second, n.start, end).some(o => o.midi >= midi)) return [];
    if ((byPitch.get(midi) ?? []).some(o => o.start < end && o.end > n.start)) return [];
    return [{ start: n.start, end, midi, vel: n.vel * DOUBLE_GAIN, weight: n.weight * DOUBLE_VALUE,
      strength: n.strength, curve: n.curve, span: n.span, nextSamePitch: Infinity, double: true }];
  });
  // O legato não pode atravessar o ataque de outra nota da mesma altura, seja
  // cópia ou nota da transcrição: cada uma pode ir para um motor diferente.
  for (const copy of copies) for (const other of [...(byPitch.get(copy.midi) ?? []), ...copies]) {
    if (other.midi !== copy.midi) continue;
    if (other.start >= copy.end) copy.nextSamePitch = Math.min(copy.nextSamePitch, other.start);
    if (copy.start >= other.end) other.nextSamePitch = Math.min(other.nextSamePitch, copy.start);
  }
  return copies;
}

// Opções (desligadas por padrão):
//   bends: a nota segue a curva fina de afinação do transcritor (vibrato, deslizes); o motor não
//          está preso a semitons. A curva vale para a duração original da nota (span).
//   mix:   cada linha extra toca mais baixo, na proporção da raiz do valor dela em relação à
//          linha 1, para a textura não embolar a melodia (mínimo 35%).
//   balance (ligado): bônus suave para uma segunda voz abaixo da primeira, sem
//          faixa MIDI fixa nem reserva obrigatória de motor para baixo.
//   salience (ligado): usa a intensidade original antes do limite de volume e
//          reduz suavemente o valor de detecções fracas, sem descartá-las.
//   sustain (ligado): transfere sustentações cortadas para um motor disponível.
//   continuity (ligado): reconecta frases entre motores sem alterar as notas
//          selecionadas nem aumentar pausas curtas; preserva a primeira linha na redução.
//   melody: favorece uma frase no registro superior da textura; fundamento na
//          segunda linha e menos dobramentos nas demais. Heurística, não separação de fontes.
//   harmony: notas fracas fora da tonalidade local, sem apoio de nota forte da
//          mesma classe por perto, valem até 50% menos na seleção.
//   voicing (com melody): a partir da terceira linha, classes de altura que já
//          soam valem menos durante toda a sobreposição; terças e sétimas acima
//          da voz mais grave valem mais.
//   double (com melody): a partir da terceira linha, a melodia uma oitava abaixo
//          concorre com as notas restantes. Essas cópias levam `double: true`.
export function dynamicLines(notes, motors, { bends = false, mix = false, balance = true, salience = true, sustain = true, melody = false, continuity = true, harmony = false, voicing = false, double = false } = {}) {
  let pool = prepareLineNotes(notes, salience)
    .sort((a, b) => a.start - b.start || b.vel - a.vel);
  const prepared = pool;
  const leadPriority = melody ? melodyPriorities(pool) : null;
  const fit = harmony ? harmonicFit(pool) : null;
  const tracks = [], origins = new Map();
  let first = 0, leadChain = [];
  for (let m = 0; m < motors; m++) {
    if (double && melody && m === 2) {
      pool = [...pool, ...melodyDoubles(leadChain, tracks[1], prepared)].sort((a, b) => a.start - b.start || b.vel - a.vel);
    }
    const role = melody && m === 0 ? n => leadPriority.get(n) : balance && m === 1 ? (n) => {
      const lead = noteAt(tracks[0], (n.start + n.end) / 2);
      // Uma quinta abaixo começa a ganhar valor; a 19 semitons o bônus chega
      // a 30% nas linhas dinâmicas, 100% na redução. Silêncios e uma primeira
      // linha já grave não forçam outro baixo.
      return lead ? 1 + (melody ? 1 : 0.3) * Math.max(0, Math.min(1, (lead.midi - n.midi - 7) / 12)) : 1;
    } : melody && m >= 2 ? n => (n.double ? 1 : voicing ? chordRole(n, tracks) : octaveRedundancy(n, tracks)) : undefined;
    const priority = fit ? n => (role ? role(n) : 1) * (fit.get(n) ?? 1) : role;
    const params = melody && m === 0 ? { ...LINE, intC: 0.1, intK: 0.25, jumpC: 1.6, jump0: 5, noteC: 0.005 } : LINE;
    const { chain, total } = bestChain(pool, priority, params);
    // Bônus de seleção não são volume: compara as linhas na mesma escala.
    const value = melody ? chain.reduce((sum, n, k) => sum + n.weight *
      ((chain[k + 1] ? Math.min(n.end, chain[k + 1].start) : n.end) - n.start), 0) : total;
    if (m === 0) { first = value; leadChain = chain; }
    const gain = mix && first > 0 ? Math.min(1, Math.max(0.35, Math.sqrt(value / first))) : 1;
    const used = new Set(chain);
    pool = pool.filter((n) => !used.has(n));
    const line = chain.map((n, k) => {
      const note = { midi: n.midi, start: n.start, end: chain[k + 1] ? Math.min(n.end, chain[k + 1].start) : n.end, vel: n.vel * gain };
      if (bends && n.curve?.length) Object.assign(note, { bends: n.curve, span: n.span });
      if (n.double) note.double = true;
      origins.set(note, n.end);
      return note;
    });
    for (let k = 0; k < line.length - 1; k++) {
      const gap = line[k + 1].start - line[k].end;
      const a = line[k], b = line[k + 1];
      // Não transforma staccato rápido em sustentação, nem preenche pausas
      // entre registros distantes. Nunca estende por cima de outro ataque uníssono.
      const limit = Math.min(LEGATO, (a.end - a.start) * 0.5, (b.end - b.start) * 0.5);
      if (gap > 0 && gap <= limit && Math.abs(a.midi - b.midi) <= 7) {
        a.end = Math.min(b.start, chain[k].nextSamePitch);
      }
    }
    tracks.push(articulate(line));
  }
  if (sustain) restoreSustains(tracks, origins, melody);
  if (continuity) connectVoices(tracks, melody ? 1 : 0);
  return tracks;
}

// A seleção gulosa pode deixar a continuação de uma frase em outro motor.
// Troca somente sufixos inteiros em fronteiras livres nos dois motores. Assim
// preserva todas as notas selecionadas, suas durações, volume e vibrato, sem
// interromper uma nota, inventar ataques ou esticar silêncios. A melodia é fixa.
function connectVoices(tracks, first) {
  const shortBreak = (a, b) => a && b && b.start - a.end > 0.03 && b.start - a.end < 0.3 ? 1 : 0;
  const cost = (a, b) => {
    if (!a || !b) return 0.6; // começo/fim de uma linha
    const gap = b.start - a.end;
    if (gap >= 0.8) return 1.2; // outra frase: sem identidade imposta entre elas
    return gap / 0.8 + Math.min(3, Math.abs(a.midi - b.midi) / 12);
  };
  const times = [...new Set(tracks.slice(first).flatMap(t => t.map(n => n.start)))].sort((a, b) => a - b);
  const positions = tracks.map(() => 0);
  for (const time of times) {
    for (let a = first; a < tracks.length; a++) {
      while (positions[a] < tracks[a].length && tracks[a][positions[a]].start < time) positions[a]++;
    }
    for (let a = first; a < tracks.length; a++) for (let b = a + 1; b < tracks.length; b++) {
      const i = positions[a], j = positions[b];
      const ap = tracks[a][i - 1], an = tracks[a][i], bp = tracks[b][j - 1], bn = tracks[b][j];
      if (ap?.end > time || bp?.end > time) continue;
      // Sem passado nos dois lados, a troca apenas renomearia os motores.
      if (!ap && !bp) continue;
      // Proximidade de altura sozinha pode transformar uma linha contínua em
      // várias pausas curtas. Nunca aceita esse aumento de fragmentação.
      if (shortBreak(ap, bn) + shortBreak(bp, an) > shortBreak(ap, an) + shortBreak(bp, bn)) continue;
      const before = cost(ap, an) + cost(bp, bn), after = cost(ap, bn) + cost(bp, an);
      if (after + 1e-9 >= before) continue;
      const tailA = tracks[a].splice(i), tailB = tracks[b].splice(j);
      tracks[a].push(...tailB);
      tracks[b].push(...tailA);
    }
  }
  // Atualiza só a articulação, sem alterar durações após a troca de vozes.
  for (let m = first; m < tracks.length; m++) for (let i = 0; i < tracks[m].length; i++) {
    const n = tracks[m][i], prev = tracks[m][i - 1];
    delete n.reattack;
    if (prev && prev.midi === n.midi && n.start - prev.end < REATTACK) n.reattack = true;
  }
}

// A seleção gulosa pode cortar uma nota para iniciar outra mesmo havendo um
// motor livre. Move a nota inteira, desde seu ataque real, para caber a cauda.
// Nunca interrompe outra voz nem prolonga além do fim estimado da transcrição.
function restoreSustains(tracks, origins, preserveLead = false) {
  const candidates = tracks.slice(preserveLead ? 1 : 0).flat().filter(n => origins.get(n) - n.end > LINE.tail)
    .sort((a, b) => (origins.get(b) - b.end) * b.vel - (origins.get(a) - a.end) * a.vel);
  for (const note of candidates) {
    const source = tracks.find(track => track.includes(note)), end = origins.get(note);
    let best = null, cost = Infinity;
    for (const track of tracks) {
      if (preserveLead && track === tracks[0]) continue;
      if (track === source || track.some(n => n.start < end && n.end > note.start)) continue;
      const prev = track.findLast(n => n.end <= note.start);
      const next = track.find(n => n.start >= end);
      const transition = (prev && note.start - prev.end < LINE.phrase ? Math.abs(prev.midi - note.midi) : 0)
        + (next && next.start - end < LINE.phrase ? Math.abs(next.midi - note.midi) : 0);
      if (transition < cost) { best = track; cost = transition; }
    }
    if (!best) continue;
    source.splice(source.indexOf(note), 1);
    note.end = end;
    best.push(note);
    best.sort((a, b) => a.start - b.start);
  }
  // Re-ataques dependem dos vizinhos no motor de destino.
  for (const track of tracks) {
    for (const note of track) delete note.reattack;
    articulate(track);
  }
}

// Um motor já reproduz um uníssono: duplicatas não devem consumir vozes extras.
// Um ataque posterior da mesma altura encerra a cauda anterior, mas continua
// sendo um ataque real; não juntamos notas repetidas nem inventamos reinícios.
function prepareLineNotes(notes, salience) {
  const pitches = new Map();
  for (const [start, end, midi, amp, curve] of notes) {
    if (![start, end, midi, amp].every(Number.isFinite) || start < 0 || end - start < 0.03
        || midi < 0 || midi > 127) continue;
    const strength = Math.max(0, Math.min(1, amp));
    const vel = Math.min(1, 0.4 + 0.8 * strength);
    // O volume satura a partir de amp=0,75; isso não pode apagar diferenças
    // na seleção. A intensidade da rede é evidência, não probabilidade calibrada.
    const weight = salience ? (0.4 + 1.6 * strength) * Math.min(1, 0.25 + 1.25 * strength)
      : Math.max(0.05, LINE.base + LINE.velW * (vel - 0.7));
    const note = { start, end, midi, vel, weight, strength, curve, span: end - start };
    if (!pitches.has(midi)) pitches.set(midi, []);
    pitches.get(midi).push(note);
  }
  const out = [];
  for (const group of pitches.values()) {
    group.sort((a, b) => a.start - b.start || b.weight - a.weight || b.end - a.end);
    const unique = group.filter((n, i) => i === 0 || n.start !== group[i - 1].start);
    unique.forEach((n, i) => {
      n.nextSamePitch = unique[i + 1]?.start ?? Infinity;
      n.end = Math.min(n.end, n.nextSamePitch);
      if (n.end - n.start >= 0.03) out.push(n);
    });
  }
  return out;
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

// Arranjo completo para N motores. Métodos: 'melodia' (redução com prioridade melódica),
// 'linhas' (linhas dinâmicas) e 'papeis' (melodia/harmonia/baixo). Com percussão, o
// último motor vira percussão.
export function arrangeMotors(job, motors, { method = 'linhas', density = 'media', percussion = true, threshold, bends = false, mix = false, balance = true, salience = true, sustain = true, continuity = true, harmony = false, voicing = false, double = false } = {}) {
  const drums = percussion && motors >= 2 && job.drums?.length ? job.drums : null;
  const tonal = drums ? motors - 1 : motors;
  let tracks, roles;
  if (method === 'linhas' || method === 'melodia') {
    const candidates = job.density?.[density] ?? job.notes;
    const notes = threshold === undefined ? candidates : candidates.filter(n => n[3] >= threshold);
    tracks = dynamicLines(notes, tonal, { bends, mix, balance, salience, sustain, continuity, harmony, voicing, double, melody: method === 'melodia' });
    roles = tracks.map(() => '');
  } else {
    ({ tracks, roles } = arrange(job, tonal, { threshold }));
  }
  if (drums) { tracks = [...tracks, percussionTrack(drums)]; roles = [...roles, 'percussão']; }
  return { title: job.title, tracks, roles, duration: job.duration };
}

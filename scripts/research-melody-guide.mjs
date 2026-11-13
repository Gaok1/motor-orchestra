// Compara um guia acústico com candidatos congelados. Concordância não é acurácia.
// node scripts/research-melody-guide.mjs downloads/research/<run>
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Uso: node scripts/research-melody-guide.mjs downloads/research/<run>');
const guideName = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'melodia.json';
assert.equal(guideName, guideName.split('/').at(-1), 'forneça somente o nome do guia no run');
const includeGuessed = process.argv.includes('--include-guessed');
const tag = guideName.replace(/\.json$/, '') + (includeGuessed ? '-with-guesses' : '');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read(join(root, 'manifest.json'));
const source = readFileSync(join(root, 'snapshot', 'score.mjs'), 'utf8');
const needle = 'n => leadPriority.get(n)';
assert.equal(source.split(needle).length, 2, 'ponto de intervenção no snapshot mudou');
const experimentPath = join(root, 'guided-score.mjs');
// Somente a cópia do snapshot recebe a função de prioridade experimental.
writeFileSync(experimentPath, source.replace(needle, 'n => globalThis.__researchGuidePriority(n, leadPriority.get(n))'));
const baseline = await import(pathToFileURL(join(root, 'snapshot', 'score.mjs')));
const experimental = await import(pathToFileURL(experimentPath));
const options = { method: 'melodia', density: 'alta', threshold: 0.15,
  percussion: true, harmony: true, voicing: true, double: true, bends: false, mix: false };
const lowerBound = (times, value) => {
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < value) lo = mid + 1; else hi = mid; }
  return lo;
};
function makeGuide(frames) {
  const times = frames.map(f => f[0]), count = frames.length;
  const voiced = new Uint32Array(count + 1);
  const pitches = new Int16Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    const [, hz, confidence] = frames[i];
    if (hz > 0 && (confidence > 0 || includeGuessed && confidence < 0)) pitches[i] = Math.round(69 + 12 * Math.log2(hz / 440));
    voiced[i + 1] = voiced[i] + Number(pitches[i] >= 0);
  }
  const cache = new Map();
  const get = midi => {
    if (!cache.has(midi)) {
      const prefix = new Uint32Array(count + 1);
      for (let i = 0; i < count; i++) prefix[i + 1] = prefix[i] + Number(pitches[i] === midi);
      cache.set(midi, prefix);
    }
    return cache.get(midi);
  };
  return {
    times, pitches,
    support(note) {
      const a = lowerBound(times, note.start), b = lowerBound(times, note.end);
      const length = b - a, prefix = get(note.midi);
      return length > 0 ? { match: (prefix[b] - prefix[a]) / length,
        voiced: (voiced[b] - voiced[a]) / length } : { match: 0, voiced: 0 };
    },
    inspect(start, end, candidates) {
      const a = lowerBound(times, start), b = lowerBound(times, end), histogram = {};
      for (let i = a; i < b; i++) if (pitches[i] >= 0) histogram[pitches[i]] = (histogram[pitches[i]] ?? 0) + 1;
      return { start, end, frames: b - a, pitchFrameCounts: histogram,
        candidates: candidates.filter(n => n[0] < end && n[1] > start)
          .map(n => ({ start: n[0], end: n[1], midi: n[2], intensity: n[3],
            ...this.support({ start: n[0], end: n[1], midi: n[2] }) })) };
    },
  };
}
function describe(track, duration, guide) {
  let active = 0, matches = 0, voiced = 0, gaps = 0, gapSeconds = 0;
  for (let i = 0; i < track.length; i++) {
    const n = track[i], length = n.end - n.start, s = guide.support(n);
    active += length; matches += s.match * length; voiced += s.voiced * length;
    if (i && n.start - track[i - 1].end > 0.15) { gaps++; gapSeconds += n.start - track[i - 1].end; }
  }
  const round = n => +n.toFixed(6);
  return { notes: track.length, activeSeconds: round(active), occupancyPct: round(100 * active / duration),
    internalGapsOver150ms: gaps, internalGapSeconds: round(gapSeconds),
    guideMatchFractionOfActive: round(matches / (active || 1)),
    guideVoicedFractionOfActive: round(voiced / (active || 1)),
    guideMatchFractionWhenBothActive: voiced ? round(matches / voiced) : null };
}
const report = { warning: 'MELODIA is another estimator, not reference truth. Agreement is not accuracy.',
  options, totalMotors: 4, guideName, includeGuessed,
  formula: '(1 - alpha * guideVoicedFraction) * originalPriority + alpha * 4 * guideMatchFraction',
  interpretation: 'Uncalibrated ablation; no candidate added/deleted, no onset/offset correction, no app integration.', songs: [] };
for (const song of manifest.songs) {
  const folder = join(root, song.id);
  if (!existsSync(join(folder, guideName))) continue;
  const job = read(join(folder, 'notes.json')), data = read(join(folder, guideName));
  const guide = makeGuide(data.frames);
  const comparisons = [];
  let reference = null;
  for (const alpha of [0, 0.25, 0.5, 1]) {
    globalThis.__researchGuidePriority = (note, original) => {
      const { match, voiced } = guide.support(note);
      return (1 - alpha * voiced) * original + alpha * 4 * match;
    };
    const started = performance.now();
    const score = (alpha === 0 ? baseline : experimental).arrangeMotors(job, 4, options);
    const milliseconds = performance.now() - started;
    if (alpha === 0) reference = score;
    // Eventos selecionados têm de existir nos candidatos congelados, exceto dobramentos marcados.
    const candidates = new Set(job.density.alta.filter(n => n[3] >= options.threshold).map(n => `${n[0]}:${n[2]}`));
    for (const track of score.tracks) for (let i = 0; i < track.length; i++) {
      const n = track[i];
      assert.ok(n.end > n.start);
      if (i) assert.ok(n.start >= track[i - 1].end);
      if (!n.double && !n.kind) assert.ok(candidates.has(`${n.start}:${n.midi}`), 'ataque inventado');
    }
    comparisons.push({ alpha, arrangementMilliseconds: +milliseconds.toFixed(3),
      ...describe(score.tracks[0], job.duration, guide),
      intro: score.tracks[0].filter(n => n.start < 8).map(n => [n.start, n.end, n.midi]) });
    writeFileSync(join(folder, `arrangement-${tag}-alpha-${alpha}.json`), JSON.stringify(score));
  }
  const times = guide.times, pitches = guide.pitches;
  let voicedFrames = 0, available = 0, selected = 0;
  const pool = job.density.alta.filter(n => n[3] >= options.threshold);
  const ordered = [...pool].sort((a, b) => a[0] - b[0]), active = new Set();
  let next = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    while (next < ordered.length && ordered[next][0] <= t) active.add(ordered[next++]);
    for (const n of active) if (n[1] <= t) active.delete(n);
    if (pitches[i] < 0 || t >= job.duration) continue;
    voicedFrames++;
    if ([...active].some(n => n[2] === pitches[i])) available++;
    if (baseline.noteAt(reference.tracks[0], t)?.midi === pitches[i]) selected++;
  }
  const windows = song.id === '0FCvzsVlXpQ'
    ? [[1.126, 1.265], [3.124, 3.264], [5.134, 5.285], [7.132, 7.283], [0, 0.5]]
    : [[38, 40.5], [70, 75], [110, 115]];
  report.songs.push({ id: song.id, title: song.title, freshCandidatesExactlyMatchCache: song.exact_match_cached_high,
    guideVoicedFrames: voicedFrames, candidateCoverageOfVoicedGuide: available / (voicedFrames || 1),
    baselineCoverageOfVoicedGuide: selected / (voicedFrames || 1), comparisons,
    diagnosticWindows: windows.map(([a, b]) => guide.inspect(a, b, pool)) });
}
delete globalThis.__researchGuidePriority;
const reportName = guideName === 'melodia.json' && !includeGuessed ? 'guide-comparison.json' : `guide-comparison-${tag}.json`;
writeFileSync(join(root, reportName), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: join(root, reportName),
  songs: report.songs.map(s => ({ id: s.id, freshCandidatesExactlyMatchCache: s.freshCandidatesExactlyMatchCache,
    candidateCoverageOfVoicedGuide: s.candidateCoverageOfVoicedGuide,
    comparisons: s.comparisons.map(({ intro, ...c }) => c),
    diagnosticWindows: s.diagnosticWindows.map(({ candidates, ...w }) => w) })) }, null, 2));

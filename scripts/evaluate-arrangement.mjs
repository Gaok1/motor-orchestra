// Avaliação temporal contra uma partitura de referência, sem bibliotecas externas.
// Não mede F1 de ataques: cobertura, precisão e recall usam uma grade de 10 ms.
import { readFileSync } from 'node:fs';
import { dynamicLines, noteAt } from '../score.mjs';

const [notesPath, referencePath, density = 'media'] = process.argv.slice(2);
if (!notesPath || !referencePath) {
  console.error('Uso: node scripts/evaluate-arrangement.mjs notas.json gabarito.json [normal|media|alta]');
  process.exit(1);
}
const job = JSON.parse(readFileSync(notesPath, 'utf8'));
const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
const notes = density === 'normal' ? job.notes : job.density?.[density] ?? job.notes;
if (!['normal', 'media', 'alta'].includes(density) || !Array.isArray(notes)
    || !Array.isArray(reference.tracks) || !(reference.duration > 0)
    || !Number.isFinite(reference.duration)) {
  throw new Error('Densidade, notas ou partitura de referência inválidas.');
}
const frames = Array.from({ length: Math.ceil(reference.duration / 0.01) }, (_, i) => {
  const t = i * 0.01;
  const pitches = reference.tracks.map(track => noteAt(track, t)?.midi ?? null);
  return { t, pitches, set: new Set(pitches.filter(p => p !== null)) };
});
function measure(tracks) {
  const hits = reference.tracks.map(() => 0), totals = reference.tracks.map(() => 0);
  let correct = 0, predicted = 0, expected = 0;
  for (const { t, pitches, set } of frames) {
    const estimate = new Set(tracks.map(track => noteAt(track, t)?.midi ?? null).filter(p => p !== null));
    for (let i = 0; i < pitches.length; i++) if (pitches[i] !== null) {
      totals[i]++;
      if (estimate.has(pitches[i])) hits[i]++;
    }
    expected += set.size;
    predicted += estimate.size;
    for (const p of estimate) if (set.has(p)) correct++;
  }
  const percent = (n, d) => d ? Number((100 * n / d).toFixed(2)) : null;
  return {
    coverageByReferenceTrack: hits.map((n, i) => percent(n, totals[i])),
    pitchPrecision: percent(correct, predicted),
    pitchRecall: percent(correct, expected),
  };
}
const comparisons = [1, 2, 3, 4, 6, 8, 12].map(motors => ({
  motors,
  previous: measure(dynamicLines(notes, motors, { salience: false, sustain: false })),
  unbalanced: measure(dynamicLines(notes, motors, { balance: false })),
  withoutSustain: measure(dynamicLines(notes, motors, { sustain: false })),
  balanced: measure(dynamicLines(notes, motors)),
  melody: measure(dynamicLines(notes, motors, { melody: true })),
}));
console.log(JSON.stringify({ density, frameSeconds: 0.01, percentages: true, comparisons }, null, 2));

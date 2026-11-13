// Executa sem dependências. O caso sintético tem gabarito; a gravação real não.
// Na gravação, registro/ocupação/saltos descrevem o arranjo, não acurácia melódica.
import { readFileSync } from 'node:fs';
import { dynamicLines, noteAt } from '../score.mjs';
import { denseOrchestra } from '../tests/fixtures/dense-orchestra.mjs';

const budgets = [1, 2, 3, 4, 6, 8, 12];
const round = n => +n.toFixed(2);
function coverage(tracks, reference) {
  let hits = 0, total = 0;
  for (const n of reference) {
    for (let t = n.start + 0.005; t < n.end; t += 0.01) {
      total++;
      if (tracks.some(track => noteAt(track, t)?.midi === n.midi)) hits++;
    }
  }
  return total ? round(100 * hits / total) : null;
}
function describe(tracks, duration) {
  const lead = tracks[0];
  const seconds = lead.reduce((sum, n) => sum + n.end - n.start, 0);
  const leaps = lead.filter((n, i) => i > 0 && n.start - lead[i-1].end < 0.5
    && Math.abs(n.midi - lead[i-1].midi) > 12).length;
  return {
    selectedNotes: tracks.flat().length,
    firstMotorNotes: lead.length,
    firstMotorOccupancyPercent: round(100 * seconds / duration),
    firstMotorMeanMidi: seconds ? round(lead.reduce((s,n) => s + n.midi * (n.end-n.start), 0) / seconds) : null,
    firstMotorLeapsAboveOctave: leaps,
  };
}
const fixture = denseOrchestra();
const report = {
  synthetic: {
    description: 'Gabarito construído com 12 vozes, melodia mais suave que o acompanhamento; não é Test Drive.',
    comparisons: budgets.map(motors => ({
      motors,
      previousMelodyCoveragePercent: coverage(dynamicLines(fixture.notes, motors), fixture.tracks[0]),
      reductionMelodyCoveragePercent: coverage(dynamicLines(fixture.notes, motors, { melody: true }), fixture.tracks[0]),
    })),
  },
};
if (process.argv[2]) {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (!Array.isArray(job.notes) || !Number.isFinite(job.duration) || job.duration <= 0) throw new Error('Transcrição inválida.');
  report.recording = {
    title: job.title, duration: job.duration,
    warning: 'Sem gabarito melódico: registro, ocupação e saltos não medem se a melodia está correta. Motores tonais, sem percussão.',
    densities: ['normal', 'media', 'alta'].map(density => {
      const notes = job.density?.[density] ?? job.notes;
      return { density, inputNotes: notes.length, comparisons: budgets.map(motors => ({
        motors,
        previous: describe(dynamicLines(notes, motors), job.duration),
        reduction: describe(dynamicLines(notes, motors, { melody: true }), job.duration),
      })) };
    }),
  };
}
console.log(JSON.stringify(report, null, 2));

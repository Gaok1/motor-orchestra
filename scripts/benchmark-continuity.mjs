// Isola a redistribuição final: mesmas notas e durações, outros motores.
// Não mede acurácia da transcrição nem fidelidade perceptiva da melodia.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { dynamicLines } from '../score.mjs';

const root = process.argv[2] ?? 'downloads';
const measure = tracks => {
  const result = { notes: 0, shortBreaks: 0, leapsAboveFifth: 0 };
  for (const track of tracks) {
    result.notes += track.length;
    for (let i = 1; i < track.length; i++) {
      const n = track[i], prev = track[i - 1], gap = n.start - prev.end;
      assert.ok(gap >= 0, 'sobreposição no motor');
      if (gap > 0.03 && gap < 0.3) result.shortBreaks++;
      if (gap < 0.8 && Math.abs(n.midi - prev.midi) > 7) result.leapsAboveFifth++;
    }
  }
  return result;
};
const selected = tracks => tracks.flat().map(({ reattack, ...n }) => n)
  .sort((a, b) => a.start - b.start || a.midi - b.midi);
const report = { density: 'alta', method: 'melodia', percussion: false, songs: [], totals: {} };
for (const entry of readdirSync(root, { withFileTypes: true })) {
  const path = join(root, entry.name, 'notes.json');
  if (!entry.isDirectory() || !existsSync(path)) continue;
  const job = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(job.density?.alta)) continue;
  const song = { id: entry.name, title: job.title, comparisons: [] };
  for (const motors of [3, 4, 6, 8, 12]) {
    const options = { melody: true, bends: true, mix: true };
    const before = dynamicLines(job.density.alta, motors, { ...options, continuity: false });
    const after = dynamicLines(job.density.alta, motors, options);
    assert.deepEqual(after[0], before[0], 'mudou a melodia');
    assert.deepEqual(selected(after), selected(before), 'mudou notas, duração, volume ou vibrato');
    const a = measure(before), b = measure(after);
    assert.ok(b.shortBreaks <= a.shortBreaks, 'aumentou pausas curtas');
    song.comparisons.push({ motors, before: a, after: b });
    const sum = report.totals[motors] ??= { before: { notes: 0, shortBreaks: 0, leapsAboveFifth: 0 },
      after: { notes: 0, shortBreaks: 0, leapsAboveFifth: 0 } };
    for (const key of Object.keys(a)) { sum.before[key] += a[key]; sum.after[key] += b[key]; }
  }
  report.songs.push(song);
}
assert.ok(report.songs.length, 'nenhuma transcrição de densidade alta encontrada');
console.log(JSON.stringify(report, null, 2));

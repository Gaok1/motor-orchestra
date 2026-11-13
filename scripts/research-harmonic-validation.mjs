// Avaliação exploratória em candidatos congelados; ocupação não mede fidelidade.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Forneça o diretório gerado por research-harmonic-prototype.mjs');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const protocol = read(join(root, 'protocol.json'));
const baseline = await import(pathToFileURL(join(root, 'baseline-score.mjs')));
const prototype = await import(pathToFileURL(join(root, 'prototype-score.mjs')));
const output = join(root, 'validation');
mkdirSync(output, { recursive: false });
function stats(track, duration) {
  let active = 0, gaps = 0, gapSeconds = 0, pitch = 0;
  for (let i = 0; i < track.length; i++) {
    const n = track[i], length = n.end - n.start;
    active += length; pitch += length * n.midi;
    if (i && n.start - track[i - 1].end > 0.15) { gaps++; gapSeconds += n.start - track[i - 1].end; }
  }
  return { notes: track.length, occupancyPct: 100 * active / duration,
    gapsOver150ms: gaps, gapSeconds, meanMidi: active ? pitch / active : null };
}
function difference(a, b, duration) {
  const edges = [...new Set([0, duration, ...a.flatMap(n => [n.start, n.end]), ...b.flatMap(n => [n.start, n.end])])].sort((x,y)=>x-y);
  let ai = 0, bi = 0, changed = 0, bothActiveChanged = 0;
  for (let i = 1; i < edges.length; i++) {
    const t = (edges[i-1] + edges[i]) / 2, dt = edges[i] - edges[i-1];
    while (ai < a.length && a[ai].end <= t) ai++;
    while (bi < b.length && b[bi].end <= t) bi++;
    const x = a[ai]?.start <= t ? a[ai].midi : null, y = b[bi]?.start <= t ? b[bi].midi : null;
    if (x !== y) { changed += dt; if (x !== null && y !== null) bothActiveChanged += dt; }
  }
  return { changedSeconds: changed, changedPct: 100*changed/duration, bothActiveChangedSeconds: bothActiveChanged };
}
const results = { protocol, warning: 'No aligned reference for real music. These are changes and structural checks, not accuracy or listener preference.', songs: [] };
for (const song of protocol.songs) {
  const job = read(join(root, 'songs', song.id + '.json'));
  const candidates = new Set(job.density.alta.filter(n => n[3] >= protocol.options.threshold).map(n => `${n[0]}:${n[2]}`));
  const entry = { ...song, budgets: [] };
  for (const motors of protocol.budgets) {
    const scores = [], measurements = [];
    for (const [name, module] of [['baseline', baseline], ['continuous', prototype]]) {
      const started = performance.now();
      const score = module.arrangeMotors(job, motors, protocol.options);
      const milliseconds = performance.now() - started;
      assert.equal(score.tracks.length, motors);
      for (const track of score.tracks) for (let i = 0; i < track.length; i++) {
        const n = track[i];
        assert.ok(Number.isFinite(n.start) && Number.isFinite(n.end) && n.end > n.start);
        if (i) assert.ok(n.start >= track[i-1].end - 1e-9, `${song.id}: overlap`);
        if (!n.double && !n.kind) assert.ok(candidates.has(`${n.start}:${n.midi}`), `${song.id}: invented onset`);
      }
      scores.push(score);
      measurements.push({ name, milliseconds, firstVoice: stats(score.tracks[0], job.duration),
        totalNotes: score.tracks.reduce((sum,t)=>sum+t.length,0) });
      if (motors === 4) writeFileSync(join(output, `${song.id}-${name}.json`), JSON.stringify(score));
    }
    entry.budgets.push({ motors, measurements, difference: difference(scores[0].tracks[0],scores[1].tracks[0],job.duration) });
  }
  results.songs.push(entry);
  writeFileSync(join(output,'results.json'), JSON.stringify(results,null,2)+'\n');
  const four = entry.budgets.find(x=>x.motors===4);
  console.log(JSON.stringify({id:song.id,phase:song.phase,title:song.title,
    changedPct:four.difference.changedPct,
    occupancy:four.measurements.map(x=>x.firstVoice.occupancyPct),gaps:four.measurements.map(x=>x.firstVoice.gapsOver150ms)}));
}
console.log(`Saved ${results.songs.length} songs × ${protocol.budgets.length} budgets × 2 algorithms. All structural assertions passed.`);

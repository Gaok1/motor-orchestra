// Prepara uma cópia controlada do arranjador e registra a hipótese do limiar 70%.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTINUOUS_HARMONICS } from '../research/continuous-harmonics.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const output = process.argv[2] ? resolve(process.argv[2]) : join(root, 'downloads', 'research', `harmonic-${Date.now()}`);
mkdirSync(output, { recursive: false });
const source = readFileSync(join(root, 'score.mjs'), 'utf8');
const helper = readFileSync(join(root, 'research', 'continuous-harmonics.mjs'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
copyFileSync(join(root, 'research', 'continuous-harmonics.mjs'), join(output, 'continuous-harmonics.mjs'));
writeFileSync(join(output, 'baseline-score.mjs'), source + '\nexport { melodyPriorities, prepareLineNotes };\n');
const tracePoint = 'const { independent } = relation(interval);';
assert.equal(source.split(tracePoint).length, 2);
const trace = `${tracePoint}
        globalThis.__harmonicTrace?.({ note: { midi: n.midi, start: n.start, end: n.end, strength: n.strength },
          parent: { midi: other.midi, start: other.start, end: other.end, strength: other.strength }, interval,
          independent, parallel: relation(interval).parallel, neighbors: [prevNote, nextNote].filter(Boolean).map(neighbor => ({
            midi: neighbor.midi, start: neighbor.start, end: neighbor.end,
            coverage: harmonicCoverage(neighbor, interval, active),
            paired: harmonicCoverage(neighbor, interval, active) >= 0.7,
          })) });`;
writeFileSync(join(output, 'trace-score.mjs'), source.replace(tracePoint, trace));
const a = source.indexOf('    const relations = new Map();', source.indexOf('function melodyPriorities('));
const b = source.indexOf('      if (other !== n && other.strength >= floor', a);
const c = source.indexOf('    const rank = total ?', b);
assert.ok(a > 0 && b > a && c > b, 'estrutura de prioridade mudou');
const replacement = `    const harmonic = continuousHarmonicShadow(n, active, [prevNote, nextNote]);
    harmonicShadow = harmonic.shadow;
    globalThis.__continuousTrace?.({ note: { midi: n.midi, start: n.start, end: n.end }, ...harmonic });
    for (const other of active) {
      const interval = n.midi - other.midi;
${source.slice(b, c)}`;
const prototype = `import { continuousHarmonicShadow } from './continuous-harmonics.mjs';\n`
  + source.slice(0, a) + replacement + source.slice(c)
  + '\nexport { melodyPriorities, prepareLineNotes };\n';
writeFileSync(join(output, 'prototype-score.mjs'), prototype);

// O protocolo e os candidatos são congelados antes de abrir resultados de validação.
const groups = { X2DUpDxFJyg: 'gravity-falls', AxRGy80De04: 'gravity-falls',
  CMiKdEpcreU: 'xote-da-alegria', QvS34v0zmMU: 'xote-da-alegria' };
const songs = [];
mkdirSync(join(output, 'songs'));
for (const id of readdirSync(join(root, 'downloads'))) {
  const path = join(root, 'downloads', id, 'notes.json');
  if (!existsSync(path)) continue;
  const data = readFileSync(path), job = JSON.parse(data);
  if (!Array.isArray(job.density?.alta)) continue;
  const phase = ['0FCvzsVlXpQ', 'PJ1yqbr8Y50'].includes(id) ? 'development'
    : id === 'AKAiUtWZ4xY' ? 'related-franchise' : 'additional-validation';
  songs.push({ id, title: job.title, duration: job.duration, analysisVersion: job.analysis_version,
    phase, group: groups[id] ?? id, hash: hash(data), notes: job.density.alta.length });
  writeFileSync(join(output, 'songs', `${id}.json`), data);
}
const protocol = { created: new Date().toISOString(), config: CONTINUOUS_HARMONICS,
  hashes: { baseline: hash(source), helper: hash(helper), prototype: hash(prototype) },
  options: { method: 'melodia', density: 'alta', threshold: 0.15, percussion: true,
    harmony: true, voicing: true, double: true, bends: false, mix: false },
  budgets: [1, 3, 4, 6, 12],
  evaluation: 'Additional cached songs, not a never-used independent dataset; some were historically used in development. No real-song annotated ground truth.',
  rule: 'No parameter change after additional-validation is inspected. If revised, version and split must be declared again.', songs };
writeFileSync(join(output, 'protocol.json'), JSON.stringify(protocol, null, 2) + '\n');
const tracing = await import(pathToFileURL(join(output, 'trace-score.mjs')));
const experimental = await import(pathToFileURL(join(output, 'prototype-score.mjs')));
const job = JSON.parse(readFileSync(join(output, 'songs', '0FCvzsVlXpQ.json'), 'utf8'));
const targets = [1.126, 3.124, 5.134, 7.132];
const target = n => n.midi === 74 && targets.some(t => Math.abs(n.start - t) < 0.0001);
const before = [], after = [];
globalThis.__harmonicTrace = event => { if (target(event.note) && event.parent.midi === 55) before.push(event); };
globalThis.__continuousTrace = event => { if (target(event.note)) after.push(event); };
tracing.arrangeMotors(job, 4, protocol.options);
experimental.arrangeMotors(job, 4, protocol.options);
delete globalThis.__harmonicTrace;
delete globalThis.__continuousTrace;
writeFileSync(join(output, 'development-trace.json'), JSON.stringify({ before, after }, null, 2) + '\n');
console.log(JSON.stringify({ output, songs: songs.length, phases: Object.fromEntries(
  [...new Set(songs.map(s => s.phase))].map(phase => [phase, songs.filter(s => s.phase === phase).length])), before, after }, null, 2));

// Verifica invariantes musicais em transcrições locais; não precisa de gabarito.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { dynamicLines } from '../score.mjs';

// Modos auditados: linhas, redução e cada um com as opções harmônicas da interface.
const CONFIGS = [{}, { harmony: true }, { melody: true },
  { melody: true, harmony: true, voicing: true, double: true }];

const root = process.argv[2] ?? 'downloads';
let arrangements = 0, recoveredSeconds = 0, songs = 0;
for (const entry of readdirSync(root, { withFileTypes: true })) {
  const path = entry.isDirectory() ? join(root, entry.name, 'notes.json') : join(root, entry.name);
  if (!path.endsWith('.json') || !existsSync(path)) continue;
  const job = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(job.notes)) continue;
  songs++;
  for (const notes of [job.notes, ...Object.values(job.density ?? {})]) {
    const onsets = new Set(notes.map(n => `${n[0]}:${n[2]}`));
    for (const motors of [1, 2, 3, 4, 6, 8, 12]) for (const config of CONFIGS) {
      const { melody = false } = config;
      const before = dynamicLines(notes, motors, { bends: true, mix: true, sustain: false, ...config });
      const after = dynamicLines(notes, motors, { bends: true, mix: true, ...config });
      if (melody) assert.deepEqual(after[0], before[0], 'recuperação mudou a linha melódica');
      assert.equal(after.length, motors);
      const byPitch = new Map(), byOnset = new Map();
      for (const track of after) for (let i = 0; i < track.length; i++) {
        const n = track[i], key = `${n.start}:${n.midi}`;
        // Cópia da melodia: mesmo ataque de uma nota da primeira linha, uma oitava abaixo.
        if (n.double) assert.ok(after[0].some(o => o.start === n.start && o.midi === n.midi + 12), 'dobramento sem melodia');
        else assert.ok(onsets.has(key), 'ataque inventado');
        assert.ok(n.end > n.start && Number.isFinite(n.end), 'duração inválida');
        assert.ok(Number.isFinite(n.vel) && n.vel >= 0 && n.vel <= 1, 'volume inválido');
        if (i) assert.ok(n.start >= track[i - 1].end, 'duas notas no mesmo motor');
        assert.ok(!byOnset.has(key), 'ataque duplicado');
        byOnset.set(key, n);
        if (!byPitch.has(n.midi)) byPitch.set(n.midi, []);
        byPitch.get(n.midi).push(n);
      }
      for (const group of byPitch.values()) {
        group.sort((a, b) => a.start - b.start);
        for (let i = 1; i < group.length; i++) assert.ok(group[i].start >= group[i - 1].end, 'uníssono duplicado');
      }
      assert.equal(byOnset.size, before.flat().length, 'sustentação mudou ataques selecionados');
      for (const n of before.flat()) {
        const restored = byOnset.get(`${n.start}:${n.midi}`);
        assert.ok(restored, 'sustentação perdeu uma nota');
        assert.ok(restored.end >= n.end, 'sustentação encurtou uma nota');
        assert.equal(restored.vel, n.vel, 'sustentação mudou o volume');
        assert.deepEqual(restored.bends, n.bends);
        assert.equal(restored.span, n.span);
        recoveredSeconds += restored.end - n.end;
      }
      arrangements++;
    }
  }
}
assert.ok(songs > 0, 'nenhuma transcrição encontrada');
console.log(JSON.stringify({ songs, arrangements, recoveredSecondsAcrossArrangements: +recoveredSeconds.toFixed(3) }, null, 2));

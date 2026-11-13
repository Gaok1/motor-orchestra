// Protótipo de pesquisa: scores limitados a [0,1], sem interpretação probabilística.
// Conserva as hipóteses; modifica apenas a prioridade de seleção.
export const CONTINUOUS_HARMONICS = Object.freeze({
  version: 'continuous-v1',
  attackSigmaSeconds: 0.06,
  strengthRatioSpan: 1 / 0.75 - 1,
  octavePenalty: 0.85,
  overtonePenalty: 0.97,
});
const unit = x => Math.max(0, Math.min(1, x));

// As notas preparadas pelo arranjador não se sobrepõem na mesma altura.
// Usa cobertura, ataque e dominância como evidência contínua; não há corte em 70%.
export function harmonicAssociation(upper, interval, notes, config = CONTINUOUS_HARMONICS) {
  const duration = upper.end - upper.start;
  if (!(duration > 0)) return { coverage: 0, weightedCoverage: 0, attack: 0, fit: 0 };
  let covered = 0, weighted = 0, attack = 0;
  for (const lower of notes) {
    if (lower.midi !== upper.midi - interval) continue;
    const overlap = Math.max(0, Math.min(lower.end, upper.end) - Math.max(lower.start, upper.start));
    if (!overlap) continue;
    const ratio = lower.strength / Math.max(upper.strength, 1e-9);
    const dominance = unit((ratio - 1) / config.strengthRatioSpan);
    const distance = (lower.start - upper.start) / config.attackSigmaSeconds;
    covered += overlap;
    weighted += overlap * dominance;
    attack = Math.max(attack, Math.exp(-0.5 * distance ** 2) * dominance);
  }
  const coverage = unit(covered / duration), weightedCoverage = unit(weighted / duration);
  return { coverage, weightedCoverage, attack, fit: weightedCoverage * attack };
}

export function continuousHarmonicShadow(note, active, neighbors, config = CONTINUOUS_HARMONICS) {
  const relatives = [...active];
  const nearby = neighbors.filter(Boolean);
  const intervals = [...new Set(relatives.map(lower => note.midi - lower.midi))]
    .filter(interval => interval >= 12 && interval % 12 === 0 || [19, 28, 31].includes(interval));
  const relations = [];
  let shadow = 1;
  for (const interval of intervals) {
    const association = harmonicAssociation(note, interval, relatives, config);
    if (!association.fit) continue;
    const evidence = nearby.map(neighbor => ({ midi: neighbor.midi, start: neighbor.start, end: neighbor.end,
      ...harmonicAssociation(neighbor, interval, relatives, config) }));
    // Um vizinho marginal não veta toda a família. Ausência de vizinhos segue
    // o comportamento legado: não constitui prova positiva de independência.
    const parallel = evidence.length ? evidence.reduce((sum, item) => sum + item.fit, 0) / evidence.length : 1;
    const continuation = parallel * (2 - parallel);
    const dependency = association.fit * continuation;
    const penalty = interval % 12 === 0 ? config.octavePenalty : config.overtonePenalty;
    const factor = 1 - penalty * dependency;
    shadow = Math.min(shadow, factor);
    relations.push({ interval, association, neighbors: evidence, parallel, continuation, dependency, factor });
  }
  return { shadow, relations };
}

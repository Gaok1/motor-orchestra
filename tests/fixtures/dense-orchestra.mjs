// Caso controlado, não transcrição de Test Drive: doze vozes simultâneas,
// tema móvel mais suave que as onze sustentações. Notas originais de teste.
export function denseOrchestra(transpose = 0) {
  const theme = [76, 78, 79, 76, 74, 76, 79, 78];
  const melody = theme.map((midi, i) => ({ start: i * 0.5, end: (i + 1) * 0.5, midi: midi + transpose }));
  const accompaniment = [36, 43, 48, 50, 52, 55, 57, 59, 60, 62, 64]
    .map(midi => ({ start: 0, end: 4, midi: midi + transpose }));
  const notes = [...melody.map(n => [n.start, n.end, n.midi, 0.4]),
    ...accompaniment.map(n => [n.start, n.end, n.midi, 0.6])];
  return { title: 'Textura densa de teste', duration: 4, notes,
    tracks: [melody, ...accompaniment.map(n => [n])] };
}

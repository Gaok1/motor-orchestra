// Gráficos em canvas. Todos leem sinais reais da simulação: AnalyserNodes ligados às
// saídas de áudio de cada motor e da soma, e o histórico da dinâmica mecânica.

import { noteName } from './score.mjs';
import { COLORS } from './engine.mjs';

const GRID = 'rgba(140,160,190,.16)', TEXT = '#8b98b0';
const buffers = new WeakMap(), spectra = new WeakMap(), ranges = new WeakMap();

function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-monospace, monospace';
  return { ctx, w, h };
}

function samples(analyser) {
  let data = buffers.get(analyser);
  if (!data) buffers.set(analyser, data = new Float32Array(analyser.fftSize));
  analyser.getFloatTimeDomainData(data);
  return data;
}

// Começa no primeiro cruzamento por zero subindo, para a onda ficar parada na tela.
function trigger(data, span) {
  for (let i = 1; i < data.length - span; i++) if (data[i - 1] <= 0 && data[i] > 0) return i;
  return 0;
}

function trace(ctx, data, start, span, w, top, height, scale, color, width = 1.4) {
  ctx.beginPath();
  for (let i = 0; i < span; i++) {
    const x = (i / (span - 1)) * w, y = top + height / 2 - data[start + i] * scale * height / 2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function axisLabel(ctx, text, x, y, align = 'left') {
  ctx.fillStyle = TEXT;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

// Gráfico 1: s_i(t) de cada motor, em faixas empilhadas.
export function drawVoices(canvas, motors, sampleRate) {
  const { ctx, w, h } = prepare(canvas);
  const live = motors.filter((m) => m.nodes);
  if (!live.length) return;
  const span = Math.round(sampleRate * 0.012); // 12 ms
  const lane = h / live.length;
  live.forEach((motor, i) => {
    const data = samples(motor.nodes.analyser);
    const top = i * lane;
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, top + lane / 2); ctx.lineTo(w, top + lane / 2); ctx.stroke();
    trace(ctx, data, trigger(data, span), span, w, top, lane, 1.6, COLORS[motors.indexOf(motor) % COLORS.length]);
    axisLabel(ctx, `s${motors.indexOf(motor) + 1}`, 4, top + 13);
  });
  axisLabel(ctx, '12 ms', w - 4, h - 4, 'right');
}

// Gráfico 2: S(t) = Σ s_i(t), lido no nó de soma (antes do limitador).
export function drawSum(canvas, analyser, motors) {
  const { ctx, w, h } = prepare(canvas);
  if (!analyser) return;
  const span = Math.round(analyser.context.sampleRate * 0.03);
  const data = samples(analyser);
  const start = trigger(data, span);
  ctx.strokeStyle = GRID;
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  // Parcelas em fundo, para comparar com a soma.
  for (const motor of motors) {
    if (!motor.nodes) continue;
    trace(ctx, samples(motor.nodes.analyser), start, span, w, 0, h, 1, COLORS[motors.indexOf(motor) % COLORS.length] + '55', 1);
  }
  trace(ctx, data, start, span, w, 0, h, 1, '#f4f7ff', 1.8);
  axisLabel(ctx, 'S(t) = Σ sᵢ(t)', 6, 14);
  axisLabel(ctx, '30 ms', w - 4, h - 4, 'right');
}

// Gráfico 3: espectro (FFT do AnalyserNode) em escala log, com as notas comandadas.
export function drawSpectrum(canvas, analyser, markers) {
  const { ctx, w, h } = prepare(canvas);
  if (!analyser) return;
  let data = spectra.get(analyser);
  if (!data) spectra.set(analyser, data = new Float32Array(analyser.frequencyBinCount));
  analyser.getFloatFrequencyData(data);
  const lo = 40, hi = 8000, nyquist = analyser.context.sampleRate / 2;
  const x = (f) => (Math.log(f / lo) / Math.log(hi / lo)) * w;
  const y = (db) => h - ((Math.max(-110, Math.min(-10, db)) + 110) / 100) * (h - 16);
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) {
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(x(f), 0); ctx.lineTo(x(f), h); ctx.stroke();
    axisLabel(ctx, f >= 1000 ? `${f / 1000}k` : String(f), x(f) + 3, h - 4);
  }
  for (const m of markers) {
    ctx.strokeStyle = m.color;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(x(m.freq), 0); ctx.lineTo(x(m.freq), h); ctx.stroke();
    ctx.setLineDash([]);
    axisLabel(ctx, noteName(m.midi), x(m.freq) + 3, 12 + 12 * (m.index % 3));
  }
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(120,220,255,.55)');
  grad.addColorStop(1, 'rgba(120,220,255,.04)');
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let px = 0; px <= w; px++) {
    const f = lo * (hi / lo) ** (px / w);
    const bin = Math.round((f / nyquist) * data.length);
    ctx.lineTo(px, y(data[Math.min(bin, data.length - 1)]));
  }
  ctx.lineTo(w, h);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = '#78dcff';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

// Gráfico 4: frequência de passos comandada (tracejada) × simulada (cheia), em log.
export function drawDynamics(canvas, motors, now, physics, span = 4) {
  const { ctx, w, h } = prepare(canvas);
  const lo = 40, hi = 4000;
  const y = (f) => h - 14 - (Math.log(Math.max(lo, f) / lo) / Math.log(hi / lo)) * (h - 22);
  const x = (t) => w - ((now - t) / span) * w;
  for (const f of [55, 110, 220, 440, 880, 1760, 3520]) {
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(0, y(f)); ctx.lineTo(w, y(f)); ctx.stroke();
    axisLabel(ctx, `${f} Hz`, 4, y(f) - 3);
  }
  const limit = (physics.maxRpm * physics.steps) / 60;
  const driver = physics.driverMax / physics.micro;
  for (const [f, label] of [[limit, 'vel. máx.'], [driver, 'limite do driver']]) {
    if (f > hi) continue;
    ctx.strokeStyle = 'rgba(255,110,110,.6)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(0, y(f)); ctx.lineTo(w, y(f)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff8f8f';
    ctx.textAlign = 'right';
    ctx.fillText(label, w - 4, y(f) - 3);
  }
  if (physics.resFreq < hi) {
    ctx.fillStyle = 'rgba(245,199,78,.08)';
    const band = physics.resFreq * physics.damping * 2;
    ctx.fillRect(0, y(physics.resFreq + band), w, y(physics.resFreq - band) - y(physics.resFreq + band));
    axisLabel(ctx, 'ressonância', w / 2, y(physics.resFreq) + 4, 'center');
  }
  motors.forEach((motor, i) => {
    const color = COLORS[i % COLORS.length];
    const points = motor.history.filter((p) => p.t <= now && p.t >= now - span);
    for (const [key, dash, width] of [['desired', [4, 4], 1], ['w', [], 2]]) {
      ctx.beginPath();
      let pen = false;
      for (const p of points) {
        if (p[key] < 1) { pen = false; continue; }
        pen ? ctx.lineTo(x(p.t), y(p[key])) : ctx.moveTo(x(p.t), y(p[key]));
        pen = true;
      }
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  });
  axisLabel(ctx, '– – comando   —— simulado', w - 4, h - 3, 'right');
}

// Sequenciador: rolo de piano por motor, com a janela andando junto do tempo.
// Escurece o que fica fora do trecho selecionado [a, b] e marca as bordas.
function shadeRegion(ctx, region, x, w, h) {
  if (!region) return;
  const xa = x(region.start), xb = x(region.end);
  ctx.fillStyle = 'rgba(5,8,14,.62)';
  if (xa > 0) ctx.fillRect(0, 0, Math.min(w, xa), h);
  if (xb < w) ctx.fillRect(Math.max(0, xb), 0, w - Math.max(0, xb), h);
  ctx.strokeStyle = '#78dcff';
  ctx.lineWidth = 1.5;
  for (const edge of [xa, xb]) {
    if (edge < 0 || edge > w) continue;
    ctx.beginPath(); ctx.moveTo(edge, 0); ctx.lineTo(edge, h); ctx.stroke();
  }
}

// focus: onde a janela fica com a música parada (o ponto de partida escolhido).
export function drawRoll(canvas, score, songTime, motorCount, region = null, focus = null, seconds = 10) {
  const { ctx, w, h } = prepare(canvas);
  if (!score) {
    axisLabel(ctx, 'Escolha uma demonstração ou uma música do YouTube.', w / 2, h / 2, 'center');
    return;
  }
  const lanes = Math.max(score.tracks.length, motorCount);
  const lane = h / lanes;
  const t0 = Math.max(0, (songTime ?? focus ?? 0) - seconds * 0.25);
  const x = (t) => ((t - t0) / seconds) * w;
  for (let i = 0; i < lanes; i++) {
    const track = score.tracks[i] ?? [];
    const color = COLORS[i % COLORS.length];
    const missing = i >= motorCount;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.045)';
    ctx.fillRect(0, i * lane, w, lane);
    const visible = track.filter((n) => n.end >= t0 && n.start <= t0 + seconds);
    if (!ranges.has(track)) {
      const midis = track.length ? track.map((n) => n.midi) : [60];
      ranges.set(track, [Math.min(...midis), Math.max(...midis) + 1]);
    }
    const [low, high] = ranges.get(track);
    for (const note of visible) {
      const yy = i * lane + 3 + (1 - (note.midi - low + 1) / (high - low + 1)) * (lane - 8);
      const playing = songTime !== null && songTime >= note.start && songTime < note.end;
      ctx.fillStyle = missing ? 'rgba(140,150,170,.35)' : playing ? '#ffffff' : color;
      ctx.globalAlpha = missing ? 1 : 0.4 + 0.6 * note.vel;
      ctx.fillRect(x(note.start), yy, Math.max(2, x(note.end) - x(note.start)), Math.max(3, lane / 10));
      ctx.globalAlpha = 1;
    }
    const role = score.roles?.[i] ? ` · ${score.roles[i]}` : '';
    axisLabel(ctx, missing ? `voz ${i + 1} (sem motor)` : `M${i + 1}${role}`, 4, i * lane + 13);
  }
  shadeRegion(ctx, region, x, w, h);
  if (songTime !== null) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x(songTime), 0); ctx.lineTo(x(songTime), h); ctx.stroke();
  }
}


// Visão geral da música inteira, para escolher o trecho. As notas são desenhadas uma
// vez numa imagem por partitura e tamanho; a cada quadro só entram seleção e cursor.
const overviews = new WeakMap();

function overview(score, motorCount, w, h, dpr) {
  const key = `${w}x${h}@${dpr}:${motorCount}`;
  const cached = overviews.get(score);
  if (cached?.key === key) return cached.image;
  const image = document.createElement('canvas');
  image.width = Math.round(w * dpr);
  image.height = Math.round(h * dpr);
  const ctx = image.getContext('2d');
  ctx.scale(dpr, dpr);
  const lanes = Math.max(1, score.tracks.length), lane = h / lanes;
  score.tracks.forEach((track, i) => {
    if (!track.length) return;
    const midis = track.map((n) => n.midi);
    const low = Math.min(...midis), span = Math.max(...midis) - low + 1;
    ctx.fillStyle = i >= motorCount ? 'rgba(140,150,170,.35)' : COLORS[i % COLORS.length];
    for (const note of track) {
      const y = i * lane + 1 + (1 - (note.midi - low + 1) / span) * Math.max(1, lane - 3);
      ctx.globalAlpha = 0.35 + 0.65 * note.vel;
      ctx.fillRect((note.start / score.duration) * w, y, Math.max(1, ((note.end - note.start) / score.duration) * w), Math.max(1.5, lane / 8));
    }
  });
  overviews.set(score, { key, image });
  return image;
}

export function drawTimeline(canvas, score, songTime, motorCount, region, cursor) {
  const { ctx, w, h } = prepare(canvas);
  if (!score) return;
  ctx.drawImage(overview(score, motorCount, w, h, window.devicePixelRatio || 1), 0, 0, w, h);
  const x = (t) => (t / score.duration) * w;
  shadeRegion(ctx, region, x, w, h);
  if (region) {
    ctx.fillStyle = 'rgba(120,220,255,.12)';
    ctx.fillRect(x(region.start), 0, x(region.end) - x(region.start), h);
  }
  const at = songTime ?? cursor;
  if (at != null) {
    ctx.strokeStyle = songTime === null ? 'rgba(255,255,255,.55)' : '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x(at), 0); ctx.lineTo(x(at), h); ctx.stroke();
  }
}

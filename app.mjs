import { Engine, COLORS } from './engine.mjs';
import { DEFAULT_PHYSICS, rpmFromPulses } from './physics.mjs';
import { DEMOS, arrangeMotors, mtof, noteName, parseScore } from './score.mjs';
import { drawDynamics, drawRoll, drawSpectrum, drawSum, drawVoices } from './charts.mjs';

const $ = (id) => document.getElementById(id);
const engine = new Engine();
const ui = new Map(); // motor → elementos do cartão
let score = null, source = null, job = null, generation = 0;

const hz = (f) => `${f.toLocaleString('pt-BR', { maximumFractionDigits: f < 100 ? 1 : 0 })} Hz`;
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

async function audio() { await engine.start(); }

function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

// ---------- Motores ----------

const NOTE_OPTIONS = Array.from({ length: 61 }, (_, i) => 36 + i)
  .map((m) => `<option value="${m}">${noteName(m)} · ${hz(mtof(m))}</option>`).join('');

function teeth() { return `<circle class="teeth" r="20" />`; }

function addMotor(midi) {
  const motor = engine.addMotor(midi);
  const card = document.createElement('article');
  card.className = 'motor';
  card.innerHTML = `
    <div class="motor-top">
      <svg class="rotor" viewBox="-32 -32 64 64" aria-hidden="true">
        <circle class="stator" r="29" />
        <g class="spin">${teeth()}<circle class="hub" r="13" /><line class="mark" x1="0" y1="0" x2="0" y2="-17" /></g>
      </svg>
      <div class="name"><strong></strong><span class="badge">Parado</span></div>
      <button type="button" class="remove" title="Remover motor">✕</button>
    </div>
    <div class="motor-row">
      <label class="check"><input type="checkbox" class="enabled" checked /> Ligado</label>
      <button type="button" class="hold">▶ Nota</button>
    </div>
    <div class="motor-row"><select class="note" aria-label="Nota">${NOTE_OPTIONS}</select></div>
    <dl class="readout">
      <dt>Nota comandada</dt><dd class="r-note">—</dd>
      <dt>Frequência desejada</dt><dd class="r-desired">—</dd>
      <dt>Pulsos do driver</dt><dd class="r-pulse">—</dd>
      <dt>Frequência efetiva</dt><dd class="r-eff">—</dd>
      <dt>Velocidade</dt><dd class="r-rpm">—</dd>
      <dt>Vibração</dt><dd><div class="meter"><span></span></div></dd>
    </dl>
    <label class="vol">Volume <input type="range" min="0" max="1" step="0.01" value="${motor.volume}" /></label>`;
  $('motor-grid').append(card);
  const q = (sel) => card.querySelector(sel);
  const els = {
    card, spin: q('.spin'), badge: q('.badge'), title: q('strong'), hold: q('.hold'),
    note: q('.r-note'), desired: q('.r-desired'), pulse: q('.r-pulse'), eff: q('.r-eff'), rpm: q('.r-rpm'), meter: q('.meter span'),
  };
  ui.set(motor, els);
  q('.note').value = midi;
  q('.note').addEventListener('change', async (e) => { await audio(); motor.midi = Number(e.target.value); engine.resync(); });
  q('.enabled').addEventListener('change', async (e) => {
    await audio();
    motor.enabled = e.target.checked;
    card.classList.toggle('off', !motor.enabled);
    engine.resync();
  });
  els.hold.addEventListener('click', async () => { await audio(); setHold(motor, !motor.hold); });
  q('.vol input').addEventListener('input', (e) => motor.setVolume(Number(e.target.value)));
  q('.remove').addEventListener('click', () => {
    engine.removeMotor(motor);
    card.remove();
    ui.delete(motor);
    relabel();
  });
  relabel();
  return motor;
}

function setHold(motor, hold) {
  motor.hold = hold;
  ui.get(motor).hold.classList.toggle('on', hold);
  ui.get(motor).hold.textContent = hold ? '■ Soltar' : '▶ Nota';
  engine.resync();
}

function relabel() {
  engine.motors.forEach((motor, i) => {
    const els = ui.get(motor);
    els.card.style.setProperty('--c', COLORS[i % COLORS.length]);
    els.title.textContent = `Motor ${i + 1}`;
  });
  if (source === 'youtube') useYoutube(false);
  updateScoreInfo();
}

$('add-motor').addEventListener('click', async () => {
  await audio();
  const used = new Set(engine.motors.map((m) => m.midi));
  addMotor([57, 45, 64, 72, 76, 81].find((m) => !used.has(m)) ?? 69);
});
$('chord').addEventListener('click', async () => {
  await audio();
  while (engine.motors.length < 3) addMotor(69);
  [69, 73, 76].forEach((midi, i) => {
    const motor = engine.motors[i];
    motor.midi = midi;
    ui.get(motor).card.querySelector('.note').value = midi;
    motor.hold = true;
  });
  engine.motors.forEach((m) => setHold(m, m.hold));
});
$('silence').addEventListener('click', () => engine.motors.forEach((m) => setHold(m, false)));

// ---------- Partituras ----------

function setScore(next, kind) {
  score = next;
  source = kind;
  document.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('on', chip.dataset.source === kind));
  updateScoreInfo();
  if (engine.transport.playing) {
    const from = kind === 'youtube' ? engine.songTime() ?? 0 : 0;
    engine.play(score, { from, original: kind === 'youtube' });
  }
}

function updateScoreInfo() {
  if (!score) return;
  const notes = score.tracks.reduce((sum, t) => sum + t.length, 0);
  const voices = score.tracks.filter((t) => t.length).length;
  const missing = voices > engine.motors.length ? ` · adicione ${voices - engine.motors.length} motor(es) para ouvir todas as vozes` : '';
  $('score-info').textContent = `${score.title} · ${voices} vozes · ${notes} notas · ${clock(score.duration)}${missing}`;
}

function loadDemo(key) {
  const demo = DEMOS[key];
  $('score-text').value = demo.text;
  $('bpm').value = demo.bpm;
  $('score-text').disabled = false;
  applyText(demo.title, key);
}

function applyText(title, kind = 'custom') {
  try {
    const parsed = parseScore($('score-text').value, Number($('bpm').value) || 120);
    $('score-error').textContent = '';
    setScore({ ...parsed, title }, kind);
  } catch (error) {
    $('score-error').textContent = error.message;
  }
}

$('apply-score').addEventListener('click', () => applyText('Partitura editada'));
document.querySelectorAll('.chip[data-source]').forEach((chip) => chip.addEventListener('click', async () => {
  await audio();
  if (chip.dataset.source === 'youtube') useYoutube(true);
  else loadDemo(chip.dataset.source);
}));

function useYoutube(select = true) {
  if (!job || (!select && source !== 'youtube')) return;
  const threshold = Number($('threshold').value);
  const method = $('method').value;
  $('threshold-value').textContent = threshold.toFixed(2);
  $('threshold-label').hidden = method !== 'papeis';
  $('density-label').hidden = $('line-options').hidden = method !== 'linhas';
  setScore(arrangeMotors(job, engine.motors.length, {
    method, threshold, density: $('density').value, percussion: $('percussion').checked,
    bends: $('bends').checked, mix: $('mix').checked,
  }), 'youtube');
}
$('threshold').addEventListener('change', () => useYoutube(false));
$('method').addEventListener('change', () => useYoutube(false));
$('density').addEventListener('change', () => useYoutube(false));
$('bends').addEventListener('change', () => useYoutube(false));
$('mix').addEventListener('change', () => useYoutube(false));
$('percussion').addEventListener('change', () => useYoutube(false));
$('threshold').addEventListener('input', () => { $('threshold-value').textContent = Number($('threshold').value).toFixed(2); });
$('original-level').addEventListener('input', (e) => engine.setOriginalLevel(Number(e.target.value)));

// ---------- YouTube ----------

$('link-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await audio();
  const current = ++generation;
  $('load-button').disabled = true;
  try {
    const response = await fetch('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: $('video-url').value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    let result;
    while (true) {
      const poll = await fetch(`/api/jobs/${data.id}`).then((r) => r.json());
      if (current !== generation) return;
      if (poll.status === 'ready') { result = poll; break; }
      if (poll.status === 'error') throw new Error(poll.error);
      setStatus(poll.message || 'Processando...');
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    setStatus('Carregando o áudio original para comparação...');
    await engine.loadOriginal(`/audio/${result.id}`);
    job = result;
    $('youtube-chip').hidden = false;
    $('youtube-chip').textContent = result.title.length > 40 ? `${result.title.slice(0, 40)}…` : result.title;
    $('youtube-controls').hidden = false;
    $('score-text').value = '# Partitura gerada pela transcrição (não editável aqui).';
    $('score-text').disabled = true;
    useYoutube(true);
    setStatus(`Pronto: “${result.title}”. Aperte Tocar. Troque a distribuição para comparar os métodos; mais motores = mais vozes.`);
  } catch (error) {
    if (current === generation) setStatus(error.message || 'Falha ao processar o vídeo.', true);
  } finally {
    if (current === generation) $('load-button').disabled = false;
  }
});

// ---------- Transporte ----------

function syncPlayButton() {
  const playing = engine.transport.playing;
  $('play').textContent = playing ? '■ Parar' : '▶ Tocar';
  $('play').classList.toggle('on', playing);
}

$('play').addEventListener('click', async () => {
  await audio();
  if (engine.transport.playing) engine.stop();
  else if (score) engine.play(score, { original: source === 'youtube' });
  syncPlayButton();
});
$('loop').addEventListener('change', (e) => engine.setLoop(e.target.checked));
$('rate').addEventListener('input', (e) => {
  const rate = Number(e.target.value);
  $('rate-value').textContent = `${Math.round(rate * 100)}%`;
  engine.setRate(rate);
});
$('volume').addEventListener('input', (e) => { if (engine.master) engine.master.gain.value = Number(e.target.value); });
document.querySelectorAll('[data-model]').forEach((button) => button.addEventListener('click', async () => {
  await audio();
  engine.setModel(button.dataset.model);
  document.querySelectorAll('[data-model]').forEach((b) => {
    b.classList.toggle('on', b === button);
    b.setAttribute('aria-checked', String(b === button));
  });
}));

// ---------- Física ----------

const PHYSICS = [
  { key: 'steps', label: 'Passos por volta', options: [[48, '48 (7,5°)'], [200, '200 (1,8°)'], [400, '400 (0,9°)']] },
  { key: 'micro', label: 'Micropassos', options: [1, 2, 4, 8, 16, 32].map((m) => [m, m === 1 ? 'passo completo' : `1/${m}`]), hint: 'mais micropassos = som mais suave, mas exige mais pulsos' },
  { key: 'maxRpm', label: 'Velocidade máxima', min: 60, max: 3000, step: 10, fmt: (v) => `${v} RPM` },
  { key: 'maxAccel', label: 'Aceleração máxima', min: 100, max: 100000, log: true, fmt: (v) => `${Math.round(v).toLocaleString('pt-BR')} RPM/s`, hint: 'torque disponível ÷ inércia 1×' },
  { key: 'inertia', label: 'Inércia do rotor + carga', min: 0.5, max: 30, log: true, fmt: (v) => `${v.toFixed(1)}×`, hint: 'divide a aceleração e alonga a resposta' },
  { key: 'tau', label: 'Tempo de resposta', min: 0.001, max: 0.15, log: true, fmt: (v) => `${(v * 1000).toFixed(1)} ms` },
  { key: 'driverMax', label: 'Pulsos máx. do driver', min: 1000, max: 50000, step: 500, fmt: (v) => `${(v / 1000).toFixed(1)} kHz` },
  { key: 'resFreq', label: 'Frequência de ressonância', min: 100, max: 3000, step: 10, fmt: (v) => `${v} Hz` },
  { key: 'resonance', label: 'Intensidade da ressonância', min: 0, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'damping', label: 'Amortecimento ζ', min: 0.02, max: 0.8, step: 0.01, fmt: (v) => v.toFixed(2), hint: 'baixo = ressonância aguda e cauda longa' },
];

function buildPhysics() {
  const root = $('physics');
  root.innerHTML = '';
  for (const p of PHYSICS) {
    const label = document.createElement('label');
    const value = engine.physics[p.key];
    let input;
    if (p.options) {
      input = document.createElement('select');
      input.innerHTML = p.options.map(([v, text]) => `<option value="${v}">${text}</option>`).join('');
      input.value = value;
    } else {
      input = document.createElement('input');
      input.type = 'range';
      if (p.log) {
        input.min = 0; input.max = 1000; input.step = 1;
        input.value = Math.round((Math.log(value / p.min) / Math.log(p.max / p.min)) * 1000);
      } else Object.assign(input, { min: p.min, max: p.max, step: p.step, value });
    }
    const read = () => p.options ? Number(input.value)
      : p.log ? p.min * (p.max / p.min) ** (input.value / 1000) : Number(input.value);
    const out = document.createElement('output');
    out.textContent = p.fmt ? p.fmt(value) : '';
    label.innerHTML = `<span>${p.label}</span>`;
    label.firstChild.append(out);
    label.append(input);
    if (p.hint) label.insertAdjacentHTML('beforeend', `<small>${p.hint}</small>`);
    input.addEventListener(p.options ? 'change' : 'input', () => {
      const v = read();
      if (p.fmt) out.textContent = p.fmt(v);
      engine.setPhysics({ [p.key]: v });
    });
    root.append(label);
  }
}
$('reset-physics').addEventListener('click', () => { engine.setPhysics({ ...DEFAULT_PHYSICS }); buildPhysics(); });

function updateFormula() {
  const P = engine.physics;
  const motor = engine.motors.find((m) => m.history.at(-1)?.midi != null) ?? engine.motors[0];
  const maxSteps = (P.maxRpm * P.steps) / 60;
  const limits = `Limites: ${hz(maxSteps)} de passos (${P.maxRpm} RPM) · driver ${hz(P.driverMax)} de pulsos = ${hz(P.driverMax / P.micro)} de passos com m=${P.micro}`;
  if (!motor) { $('formula').textContent = limits; return; }
  const midi = motor.history.at(-1)?.midi ?? motor.midi;
  const f = mtof(midi), pulses = f * P.micro;
  $('formula').innerHTML = `Motor ${engine.motors.indexOf(motor) + 1} · ${noteName(midi)}: f(n) = 440·2<sup>(${midi}−69)/12</sup> = ${hz(f)} de passos → `
    + `f<sub>pulso</sub> = f·m = ${hz(pulses)} → RPM = 60·f<sub>pulso</sub>/(N·m) = 60·${Math.round(pulses)}/(${P.steps}·${P.micro}) = ${rpmFromPulses(pulses, P).toFixed(1)}`
    + `<br>${limits}`;
}

// ---------- Animação ----------

let lastFrame = performance.now(), lastText = 0;
function frame(nowMs) {
  const dt = (nowMs - lastFrame) / 1000;
  lastFrame = nowMs;
  const ctx = engine.ctx, now = ctx ? ctx.currentTime : 0;
  const updateText = nowMs - lastText > 90;
  if (updateText) lastText = nowMs;
  const markers = [];

  engine.motors.forEach((motor, i) => {
    const els = ui.get(motor), s = ctx ? motor.at(now) : null;
    if (s) motor.angle = (motor.angle + (s.rpm / 60) * 360 * dt) % 360;
    els.spin.setAttribute('transform', `rotate(${motor.angle.toFixed(1)})`);
    if (s?.midi != null) markers.push({ freq: mtof(s.midi), midi: s.midi, color: COLORS[i % COLORS.length], index: i });
    if (!updateText) return;
    const on = s?.midi != null;
    const status = !s || (!on && s.w < 1) ? ['Parado', '']
      : s.losing ? ['Perdendo passos', 'bad']
      : s.driverSat ? ['Driver saturado', 'bad']
      : s.speedSat ? ['Acima da vel. máx.', 'bad']
      : !on ? ['Desacelerando', 'lag']
      : s.lagging ? ['Acompanhando…', 'lag'] : ['Girando', 'run'];
    els.badge.textContent = status[0];
    els.badge.className = `badge ${status[1]}`;
    els.card.classList.toggle('sat', status[1] === 'bad');
    els.note.textContent = on ? noteName(s.midi) : '—';
    els.desired.textContent = on ? hz(s.desired) : '—';
    els.pulse.textContent = on ? hz(s.pulseCmd) : '—';
    els.pulse.classList.toggle('warn', Boolean(s?.driverSat));
    els.eff.textContent = s && s.w >= 1 ? hz(s.w) : '—';
    els.eff.classList.toggle('warn', Boolean(on && s.lagging));
    els.rpm.textContent = s ? `${s.rpm.toFixed(1)} RPM` : '—';
    els.meter.style.width = `${Math.min(100, ((s?.amp ?? 0) / 1.6) * 100)}%`;
  });

  if (ctx) {
    drawVoices($('voices'), engine.motors, ctx.sampleRate);
    drawSum($('sum'), engine.analyser, engine.motors);
    drawSpectrum($('spectrum'), engine.analyser, markers);
    drawDynamics($('dynamics'), engine.motors, now, engine.physics);
  }
  const songTime = engine.songTime();
  if (engine.transport.playing && songTime === null && now > engine.transport.start) {
    engine.stop();
    syncPlayButton();
  }
  drawRoll($('roll'), score, songTime, engine.motors.length);
  if (updateText) {
    $('clock').textContent = clock(songTime ?? 0);
    updateFormula();
  }
  requestAnimationFrame(frame);
}

// ---------- Início ----------

for (const midi of [69, 73, 76]) addMotor(midi); // Lá4, Dó♯5, Mi5
buildPhysics();
loadDemo('chords');
setStatus('Clique em “Acorde de Lá maior” ou em “▶ Nota” de um motor para ouvir. O áudio começa no primeiro clique.');
requestAnimationFrame(frame);

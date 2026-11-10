// Modelo mecânico simplificado de um motor de passo. Função pura, sem Web Audio,
// para poder ser testada no Node. Unidades: "w" é a taxa de passos completos (Hz).
//
// Cadeia: nota → frequência de passos desejada → pulsos do driver (× micropassos)
//         → limites do driver e do motor → dinâmica (1ª ordem + aceleração máxima)
//         → ressonância → som.
// A dinâmica e a perda de passos são aproximações fenomenológicas, não um modelo de torque.

export const DEFAULT_PHYSICS = {
  steps: 200,        // passos completos por volta (1,8°)
  micro: 1,          // fator de micropassos
  maxRpm: 900,       // velocidade máxima que o motor alcança
  maxAccel: 30000,   // aceleração máxima com inércia 1× (RPM/s)
  inertia: 1,        // multiplicador da inércia do rotor + carga
  tau: 0.008,        // constante de tempo da resposta (s), com inércia 1×
  driverMax: 20000,  // maior taxa de pulsos que o driver gera (Hz)
  resFreq: 700,      // frequência natural do conjunto rotor/carcaça (Hz)
  resonance: 0.5,    // intensidade da ressonância (0 a 1)
  damping: 0.15,     // fator de amortecimento ζ
};

export const SIM_DT = 1 / 250;

export const rpmFromPulses = (pulseHz, P) => (60 * pulseHz) / (P.steps * P.micro);

// Fator de amplificação de um oscilador harmônico amortecido excitado em r = f/fn.
export function magnification(f, P) {
  const r = f / P.resFreq, z = P.damping;
  return 1 / Math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2);
}

// Avança um passo de simulação. `cmd` é { freq, vel } (frequência da nota) ou null.
// `random` é injetável para testes determinísticos.
export function stepMotor(state, cmd, P, dt = SIM_DT, random = Math.random) {
  const desired = cmd ? cmd.freq : 0;                 // passos completos/s pedidos pela nota
  const pulseCmd = desired * P.micro;                  // pulsos/s que o driver teria de gerar
  const driverSat = pulseCmd > P.driverMax;
  const maxSteps = (P.maxRpm * P.steps) / 60;
  const reachable = Math.min(pulseCmd, P.driverMax) / P.micro;
  const speedSat = reachable > maxSteps;
  const target = Math.min(reachable, maxSteps);

  // 1ª ordem com constante de tempo proporcional à inércia, limitada pela aceleração
  // (torque / inércia). Simplificação: não modela curva torque × velocidade.
  const tau = Math.max(1e-4, P.tau * P.inertia);
  const aMax = (P.maxAccel * P.steps) / 60 / P.inertia;     // passos/s²
  let dw = (target - state.w) * (1 - Math.exp(-dt / tau));
  dw = Math.max(-aMax * dt, Math.min(aMax * dt, dw));
  let w = state.w + dw;

  // Ressonância de meia faixa: perto da frequência natural a vibração cresce e,
  // se passar de um limiar, o rotor perde passos (velocidade efetiva cai aos trancos).
  const mag = magnification(w, P);
  const risk = P.resonance * mag;
  const losing = Boolean(cmd) && w > 20 && risk > 2.5;
  if (losing) w *= 1 - Math.min(0.35, (risk - 2.5) * 0.05) * random();

  // Amplitude do som: depende da intensidade da nota, da velocidade (motor quase parado
  // quase não vibra) e da ressonância.
  const presence = Math.min(1, w / 60);
  const boost = 1 + P.resonance * (Math.min(mag, 6) - 1) * 0.35;
  const amp = cmd ? cmd.vel * presence * boost : 0;

  return {
    w, desired, pulseCmd, target, driverSat, speedSat, losing, mag, amp,
    rpm: (w * 60) / P.steps,
    lagging: Boolean(cmd) && Math.abs(w - desired) > desired * 0.03,
  };
}

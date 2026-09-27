// 物理建模式的加法合成：编钟与建鼓
// 以衰减正弦（模态）叠加生成，每个分音有独立的频率比、振幅与衰减时间。

// 编钟分音表：[频率比, 振幅, 衰减时间系数]
// 合瓦形钟体的分音不成整数倍，且成对出现（形成缓慢的“拍”），高分音衰减更快。
const BELL_PARTIALS = [
  [1.0, 1.0, 1.0],
  [1.0027, 0.3, 0.92], // 与基音形成约 0.5–1 Hz 的拍
  [2.005, 0.12, 0.62],
  [2.41, 0.4, 0.5],
  [2.437, 0.13, 0.47],
  [2.94, 0.25, 0.4],
  [3.72, 0.2, 0.31],
  [4.6, 0.13, 0.25],
  [5.56, 0.09, 0.2],
  [6.63, 0.065, 0.16],
  [7.81, 0.045, 0.13],
  [9.12, 0.03, 0.1],
];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bellDecayTime(freq) {
  return Math.min(8, Math.max(1.6, 8.5 * Math.pow(freq / 65.4, -0.45)));
}

// 叠加一个指数衰减的正弦（用复数旋转递推，避免逐点 sin）
function addMode(out, sr, freq, amp, t60, phase, fastPortion = 0.3, fastRate = 5) {
  if (freq >= sr * 0.46 || amp <= 0) return;
  const w = (2 * Math.PI * freq) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let re = Math.cos(phase);
  let im = Math.sin(phase);
  const k = 6.9078 / t60; // -60 dB
  const d1 = Math.exp(-k / sr);
  const d2 = Math.exp(-fastRate / sr);
  let e1 = amp;
  let e2 = fastPortion;
  const slow = 1 - fastPortion;
  const n = out.length;
  for (let i = 0; i < n; i++) {
    out[i] += im * e1 * (slow + e2);
    const nr = re * cw - im * sw;
    im = re * sw + im * cw;
    re = nr;
    e1 *= d1;
    e2 *= d2;
    if (e1 < 1e-5) break;
  }
}

// 二阶共振滤波的噪声猝发（木槌击铜的“当”声瞬态）
function addNoiseBurst(out, sr, rnd, fc, bw, amp, tau) {
  const r = Math.exp((-Math.PI * bw) / sr);
  const th = (2 * Math.PI * fc) / sr;
  const a1 = 2 * r * Math.cos(th);
  const a2 = -r * r;
  const g = (1 - r) * 2.2;
  let y1 = 0;
  let y2 = 0;
  const n = Math.min(out.length, Math.floor(sr * tau * 8));
  const dec = Math.exp(-1 / (sr * tau));
  let env = amp;
  for (let i = 0; i < n; i++) {
    const x = (rnd() * 2 - 1) * env;
    const y = g * x + a1 * y1 + a2 * y2;
    y2 = y1;
    y1 = y;
    out[i] += y;
    env *= dec;
  }
}

export function renderBellTone(freq, sr, seed = 1) {
  const rnd = mulberry(seed);
  const T = bellDecayTime(freq);
  const dur = Math.min(T * 1.02, 8.2);
  const out = new Float32Array(Math.floor(dur * sr));

  // 高音钟分音衰减稍快，低音钟保留更多高频泛音（钟体更大）
  const brightness = Math.pow(freq / 262, -0.12);
  for (const [ratio, amp, dk] of BELL_PARTIALS) {
    const f = freq * ratio * (1 + (rnd() - 0.5) * 0.0016);
    const a = ratio > 1.5 ? amp * brightness : amp;
    addMode(out, sr, f, a, T * dk, rnd() * Math.PI * 2);
  }
  // 金属撞击的短促高频“铮”声
  [11.3, 13.85, 16.9, 20.4].forEach((r, i) => {
    addMode(out, sr, freq * r, 0.05 / (i + 1), 0.09 + 0.03 * rnd(), rnd() * 6.28, 0);
  });
  // 木槌击点的噪声瞬态：高音钟偏亮，低音钟（撞钟棒）偏闷
  addNoiseBurst(out, sr, rnd, Math.min(freq * 3.1, 3600), 900, 0.35, 0.008);
  addNoiseBurst(out, sr, rnd, freq < 200 ? 160 : 420, 260, 0.25, 0.018);

  // 起音 2 ms 线性上升，去除爆音；末尾淡出
  const att = Math.floor(sr * 0.002);
  for (let i = 0; i < att; i++) out[i] *= i / att;
  const fade = Math.floor(sr * 0.25);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;

  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const norm = 0.85 / (peak || 1);
  for (let i = 0; i < out.length; i++) out[i] *= norm;
  return out;
}

// 建鼓：D 重击 d 中击 r 滚奏轻击 x 击鼓框
export function renderDrum(type, sr, seed = 7) {
  const rnd = mulberry(seed);
  const spec = {
    D: { dur: 1.8, f0: 56, sweep: 52, sweepRate: 16, decay: 2.8, noise: 0.55, slap: 0.3 },
    d: { dur: 1.1, f0: 70, sweep: 40, sweepRate: 20, decay: 4.2, noise: 0.45, slap: 0.35 },
    r: { dur: 0.6, f0: 76, sweep: 30, sweepRate: 26, decay: 7.5, noise: 0.5, slap: 0.3 },
  }[type];
  if (type === 'x') {
    const out = new Float32Array(Math.floor(0.35 * sr));
    addMode(out, sr, 830, 0.7, 0.14, 0, 0);
    addMode(out, sr, 1390, 0.45, 0.1, 1, 0);
    addMode(out, sr, 2230, 0.25, 0.06, 2, 0);
    addNoiseBurst(out, sr, rnd, 3000, 2500, 0.8, 0.004);
    return normalize(out, 0.8);
  }
  const out = new Float32Array(Math.floor(spec.dur * sr));
  let ph1 = 0;
  let ph2 = 0;
  let ph3 = 0;
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = spec.f0 + spec.sweep * Math.exp(-t * spec.sweepRate);
    ph1 += (2 * Math.PI * f) / sr;
    ph2 += (2 * Math.PI * f * 1.53) / sr;
    ph3 += (2 * Math.PI * f * 2.11) / sr;
    const body =
      Math.sin(ph1) * Math.exp(-t * spec.decay) +
      0.32 * Math.sin(ph2) * Math.exp(-t * spec.decay * 1.8) +
      0.14 * Math.sin(ph3) * Math.exp(-t * spec.decay * 2.6);
    const nz = rnd() * 2 - 1;
    lp += 0.08 * (nz - lp);
    const thump = lp * spec.noise * 3 * Math.exp(-t * 35);
    const slap = nz * spec.slap * Math.exp(-t * 140);
    out[i] = Math.tanh((body + thump + slap) * 1.5);
  }
  const att = Math.floor(sr * 0.001);
  for (let i = 0; i < att; i++) out[i] *= i / att;
  return normalize(out, 0.9);
}

function normalize(out, target) {
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const k = target / (peak || 1);
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

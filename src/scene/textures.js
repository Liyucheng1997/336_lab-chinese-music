// 程序化纹理：青铜钟面（枚、篆、钲、鼓纹与错金铭文）、通用青铜、漆木、地面、窗棂、鼓皮
import * as THREE from 'three';
import { ValueNoise, mulberry32, smoothstep, mix, clamp01 } from './noise.js';

// 钟面布局（u 为从一侧铣棱到另一侧的弧长比例，v 为自舞部向下的高度比例）
export const FACE = {
  zheng: { x0: 0.415, x1: 0.585, y0: 0.05, y1: 0.56 },
  regions: [{ x0: 0.075, x1: 0.385 }, { x0: 0.615, x1: 0.925 }],
  regionY: [0.05, 0.56],
  bandH: 0.035,
  bandTops: [0.05, 0.2083, 0.3667, 0.525],
  rowCenters: [0.1467, 0.305, 0.4633],
  colFracs: [0.2, 0.5, 0.8],
  guTop: 0.585,
  strikeMain: { s: 0.5, v: 0.84 },
  strikeSide: { s: 0.24, v: 0.84 },
};

const K = 0.68; // 钟面纹理的纵横比校正（弧长 ≈ 0.68 × 钟高）

const gray = (v) => `rgb(${v},${v},${v})`;
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { srgb = false, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function imageToCanvas(data, w, h) {
  const c = makeCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

// ───────────────────────────── 纹样基元 ─────────────────────────────

function spiralPoints(cx, cy, r, turns, a0, dir) {
  const pts = [];
  const steps = Math.max(12, Math.ceil(turns * 30));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = a0 + dir * t * turns * Math.PI * 2;
    const rr = r * (0.12 + 0.88 * t);
    pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
  }
  return pts;
}

function strokePts(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

// 云纹 S 形：两个反向涡卷由弧线相连（蟠螭纹的基本单元）
function cloudS(ctx, x, y, w, h, flip = false) {
  const r = Math.min(w * 0.24, h * 0.46);
  const ax = x + w * 0.25;
  const bx = x + w * 0.75;
  const cy = y + h * 0.5;
  const s = flip ? -1 : 1;
  const A = spiralPoints(ax, cy, r, 1.35, Math.PI / 2 * s, s);
  const B = spiralPoints(bx, cy, r, 1.35, -Math.PI / 2 * s, s).reverse();
  const a = A[A.length - 1];
  const b = B[0];
  ctx.beginPath();
  A.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.bezierCurveTo(a[0] + w * 0.2, a[1], b[0] - w * 0.2, b[1], b[0], b[1]);
  B.forEach(([px, py]) => ctx.lineTo(px, py));
  ctx.stroke();
}

// 云雷纹（方形回纹）
function leiwen(ctx, x, y, s) {
  ctx.beginPath();
  let cx = x + s / 2;
  let cy = y + s / 2;
  let len = s * 0.12;
  ctx.moveTo(cx, cy);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let i = 0; i < 7; i++) {
    const [dx, dy] = dirs[i % 4];
    cx += dx * len;
    cy += dy * len;
    ctx.lineTo(cx, cy);
    if (i % 2 === 1) len += s * 0.13;
  }
  ctx.stroke();
}

function band(ctx, x0, y0, x1, y1, fillV, lineV, lw, rnd, kind = 'cloud') {
  ctx.fillStyle = gray(fillV);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = gray(lineV);
  ctx.lineWidth = lw;
  const h = y1 - y0;
  if (kind === 'lei') {
    const s = h * 0.9;
    const n = Math.floor((x1 - x0) / (s * 1.5 * K + 1e-6));
    const step = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(x0 + i * step + step / 2, y0 + h / 2);
      ctx.scale(K, 1);
      leiwen(ctx, -s / 2, -s / 2, s);
      ctx.restore();
    }
    return;
  }
  const unitW = h * 2.4 * K;
  const n = Math.max(1, Math.round((x1 - x0) / unitW));
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    cloudS(ctx, x0 + i * w + w * 0.04, y0 + h * 0.08, w * 0.92, h * 0.84, (i + (rnd() < 0.5 ? 0 : 1)) % 2 === 0);
  }
}

function frame(ctx, x0, y0, x1, y1, v, lw) {
  ctx.strokeStyle = gray(v);
  ctx.lineWidth = lw;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

// 鼓部蟠龙纹：左右对称的涡卷组合
function guMotif(ctx, rnd) {
  const draw = () => {
    ctx.lineWidth = 0.0045;
    ctx.strokeStyle = gray(182);
    // 主体：大涡卷（龙目）与回旋的躯干
    const eye = spiralPoints(0.405, 0.735, 0.05, 1.8, 0, 1);
    strokePts(ctx, eye.map(([x, y]) => [x, 0.735 + (y - 0.735) * K * 1.4]));
    ctx.beginPath();
    ctx.moveTo(0.5, 0.64);
    ctx.bezierCurveTo(0.45, 0.63, 0.33, 0.66, 0.3, 0.72);
    ctx.bezierCurveTo(0.27, 0.79, 0.35, 0.83, 0.42, 0.82);
    ctx.bezierCurveTo(0.47, 0.81, 0.49, 0.86, 0.46, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.5, 0.94);
    ctx.bezierCurveTo(0.42, 0.95, 0.3, 0.93, 0.24, 0.88);
    ctx.bezierCurveTo(0.2, 0.84, 0.22, 0.76, 0.26, 0.7);
    ctx.stroke();
    // 小涡卷与勾角（羽翅）
    const curls = [
      [0.33, 0.9, 0.024, 1.2, 1], [0.37, 0.67, 0.02, 1.1, -1], [0.22, 0.66, 0.018, 1.1, 1],
      [0.45, 0.77, 0.018, 1.1, -1], [0.29, 0.8, 0.017, 1.2, -1], [0.41, 0.885, 0.016, 1.1, 1],
    ];
    ctx.lineWidth = 0.0035;
    curls.forEach(([x, y, r, t, d]) => {
      const pts = spiralPoints(x, y, r, t, rnd() * 6.28, d);
      strokePts(ctx, pts.map(([px, py]) => [px, y + (py - y) * K * 1.4]));
    });
    // 细密的鳞纹填充
    ctx.lineWidth = 0.002;
    ctx.strokeStyle = gray(160);
    for (let i = 0; i < 26; i++) {
      const x = 0.25 + rnd() * 0.22;
      const y = 0.68 + rnd() * 0.24;
      ctx.beginPath();
      ctx.arc(x, y, 0.008, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    }
  };
  draw();
  ctx.save();
  ctx.translate(1, 0);
  ctx.scale(-1, 1);
  draw();
  ctx.restore();
  // 外框
  ctx.strokeStyle = gray(172);
  ctx.lineWidth = 0.004;
  ctx.beginPath();
  ctx.moveTo(0.19, 0.955);
  ctx.bezierCurveTo(0.17, 0.8, 0.2, 0.66, 0.26, 0.62);
  ctx.lineTo(0.74, 0.62);
  ctx.bezierCurveTo(0.8, 0.66, 0.83, 0.8, 0.81, 0.955);
  ctx.stroke();
}

// 侧鼓部的小鸾鸟标记（侧鼓音敲击点）
function birdMark(ctx, x, y, dir) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, K * 1.3);
  ctx.strokeStyle = gray(190);
  ctx.lineWidth = 0.004;
  strokePts(ctx, spiralPoints(0, 0, 0.018, 1.3, 0, 1));
  ctx.beginPath();
  ctx.moveTo(0.018, -0.004);
  ctx.quadraticCurveTo(0.04, -0.03, 0.03, -0.045);
  ctx.moveTo(-0.016, 0.01);
  ctx.quadraticCurveTo(-0.035, 0.03, -0.05, 0.02);
  ctx.stroke();
  ctx.restore();
}

// 错金铭文（竖排）
function inscribe(ctx, S, text, cx, y0, charW, fontStack) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(charW)}px ${fontStack}`;
  const step = charW * K * 1.18;
  [...text].forEach((ch, i) => {
    ctx.save();
    ctx.translate(cx * S, y0 * S + step * (i + 0.5));
    ctx.scale(1, K);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

const INSCRIPTION_FONT = '"LiSu","隶书","STLiti","SimLi","KaiTi","STKaiti",serif';

// ───────────────────────────── 青铜合成 ─────────────────────────────

function composeBronze(S, W, heightData, goldData, noise, opts = {}) {
  const color = new Uint8ClampedArray(W * S * 4);
  const orm = new Uint8ClampedArray(W * S * 4);
  const emi = new Uint8ClampedArray(W * S * 4);
  const bump = new Uint8ClampedArray(W * S * 4);
  const fx = opts.freq ?? 5;
  const patinaBias = opts.patina ?? 0;
  const rnd = mulberry32(opts.seed ?? 3);
  const pits = new Float32Array(W * S);
  for (let i = 0; i < W * S * 0.0025; i++) {
    const p = Math.floor(rnd() * W * S);
    pits[p] = 0.6 + rnd() * 0.4;
  }
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const i = y * W + x;
      const j = i * 4;
      const hv = heightData ? heightData[j] / 255 : 0.5;
      const gold = goldData ? goldData[j] / 255 : 0;
      const pat = noise.fbm(u, v, fx, 5, Math.round(fx * (S / W)) || fx);
      const grain = noise.fbm(u, v, 96, 2, Math.round(96 * (S / W)) || 96);
      const streak = noise.fbm(u, v * 0.25, 22, 2, 6);

      const raised = smoothstep(0.54, 0.72, hv);
      const recess = smoothstep(0.49, 0.3, hv);
      let P = smoothstep(0.5, 0.74, pat + (opts.bottomPatina ? smoothstep(0.75, 1, v) * 0.12 : 0) + patinaBias);
      P = clamp01(P * 0.85 + recess * 0.45 - raised * 0.35 + pits[i] * 0.6);

      // 铜胎：暗金 → 高光处打磨后的金铜色
      let r = mix(92, 186, raised * 0.85 + grain * 0.12);
      let g = mix(70, 146, raised * 0.85 + grain * 0.1);
      let b = mix(46, 92, raised * 0.85 + grain * 0.08);
      const st = (streak - 0.5) * 18;
      r += st; g += st * 0.8; b += st * 0.5;
      // 凹处积垢
      r = mix(r, 40, recess * 0.55);
      g = mix(g, 30, recess * 0.55);
      b = mix(b, 22, recess * 0.55);
      // 铜绿锈
      const pl = 0.8 + grain * 0.5;
      r = mix(r, 62 * pl, P * 0.8);
      g = mix(g, 106 * pl, P * 0.8);
      b = mix(b, 88 * pl, P * 0.8);
      // 错金
      r = mix(r, 214, gold);
      g = mix(g, 166, gold);
      b = mix(b, 84, gold);

      color[j] = r; color[j + 1] = g; color[j + 2] = b; color[j + 3] = 255;

      let rough = mix(0.46, 0.32, raised) + (grain - 0.5) * 0.12;
      rough = mix(rough, 0.8, P);
      rough = mix(rough, 0.34, gold);
      let metal = mix(0.95, 0.3, P);
      metal = mix(metal, 1, gold);
      orm[j] = 255; orm[j + 1] = clamp01(rough) * 255; orm[j + 2] = clamp01(metal) * 255; orm[j + 3] = 255;

      const e = clamp01(gold + raised * 0.5 * (1 - P * 0.7) + 0.04);
      emi[j] = e * 255; emi[j + 1] = e * 255; emi[j + 2] = e * 255; emi[j + 3] = 255;

      const bh = clamp01(hv + (grain - 0.5) * 0.05 - pits[i] * 0.08 + (P > 0.6 ? (pat - 0.5) * 0.06 : 0));
      bump[j] = bump[j + 1] = bump[j + 2] = bh * 255; bump[j + 3] = 255;
    }
  }
  return {
    map: toTexture(imageToCanvas(color, W, S), { srgb: true, repeat: opts.repeat }),
    ormMap: toTexture(imageToCanvas(orm, W, S), { repeat: opts.repeat }),
    emissiveMap: toTexture(imageToCanvas(emi, W, S), { srgb: true, repeat: opts.repeat }),
    bumpMap: toTexture(imageToCanvas(bump, W, S), { repeat: opts.repeat }),
  };
}

// 钟面纹理（type: 'yong' 甬钟 / 'niu' 钮钟）
export function createBellFaceTextures(type) {
  const S = 1024;
  const hc = makeCanvas(S, S);
  const h = hc.getContext('2d');
  const gc = makeCanvas(S, S);
  const g = gc.getContext('2d');
  const rnd = mulberry32(type === 'yong' ? 11 : 23);

  h.fillStyle = gray(128);
  h.fillRect(0, 0, S, S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  h.setTransform(S, 0, 0, S, 0, 0);
  h.lineCap = 'round';
  h.lineJoin = 'round';

  // 舞部边带（云雷纹）与于口唇
  band(h, 0, 0.004, 1, 0.034, 146, 180, 0.003, rnd, 'lei');
  h.fillStyle = gray(168);
  h.fillRect(0, 0.972, 1, 0.028);
  // 铣棱
  h.strokeStyle = gray(172);
  h.lineWidth = 0.007;
  h.beginPath();
  h.moveTo(0.006, 0.03); h.lineTo(0.006, 0.975);
  h.moveTo(0.994, 0.03); h.lineTo(0.994, 0.975);
  h.stroke();

  // 钲部
  const Z = FACE.zheng;
  h.fillStyle = gray(140);
  h.fillRect(Z.x0, Z.y0, Z.x1 - Z.x0, Z.y1 - Z.y0);
  frame(h, Z.x0, Z.y0, Z.x1, Z.y1, 178, 0.005);
  frame(h, Z.x0 + 0.01, Z.y0 + 0.008, Z.x1 - 0.01, Z.y1 - 0.008, 160, 0.002);

  const [ry0, ry1] = FACE.regionY;
  FACE.regions.forEach((R) => {
    frame(h, R.x0, ry0, R.x1, ry1, 176, 0.004);
    if (type === 'yong') {
      // 篆带（蟠螭纹）
      FACE.bandTops.forEach((top) => band(h, R.x0, top, R.x1, top + FACE.bandH, 150, 186, 0.0028, rnd));
      // 枚座
      FACE.rowCenters.forEach((cy) => {
        FACE.colFracs.forEach((f) => {
          const cx = R.x0 + (R.x1 - R.x0) * f;
          h.fillStyle = gray(176);
          h.beginPath();
          h.ellipse(cx, cy, 0.036, 0.036 * K * 1.02, 0, 0, Math.PI * 2);
          h.fill();
          h.strokeStyle = gray(120);
          h.lineWidth = 0.003;
          h.beginPath();
          h.ellipse(cx, cy, 0.042, 0.042 * K * 1.02, 0, 0, Math.PI * 2);
          h.stroke();
        });
      });
    } else {
      // 钮钟：三格满饰蟠螭纹
      const cell = (ry1 - ry0) / 3;
      for (let k = 0; k < 3; k++) {
        const y0 = ry0 + k * cell + 0.012;
        const y1 = y0 + cell - 0.024;
        const rows = 3;
        for (let r = 0; r < rows; r++) {
          const a = y0 + ((y1 - y0) / rows) * r;
          band(h, R.x0 + 0.008, a, R.x1 - 0.008, a + (y1 - y0) / rows, 144, 184, 0.0026, rnd);
        }
        frame(h, R.x0 + 0.004, y0 - 0.004, R.x1 - 0.004, y1 + 0.004, 172, 0.003);
      }
    }
  });

  // 鼓部
  h.strokeStyle = gray(174);
  h.lineWidth = 0.005;
  h.beginPath();
  h.moveTo(0.02, FACE.guTop); h.lineTo(0.98, FACE.guTop);
  h.stroke();
  guMotif(h, rnd);
  birdMark(h, FACE.strikeSide.s, FACE.strikeSide.v, 1);
  birdMark(h, 1 - FACE.strikeSide.s, FACE.strikeSide.v, -1);

  // 错金铭文
  inscribe(g, S, '曾侯乙作持用終', 0.5, Z.y0 + 0.02, 78, INSCRIPTION_FONT);
  inscribe(g, S, '姑洗之宮', 0.1, 0.62, 42, INSCRIPTION_FONT);
  inscribe(g, S, '穆音之羽', 0.9, 0.62, 42, INSCRIPTION_FONT);
  if (type === 'niu') {
    inscribe(g, S, '新鐘之徵', 0.23, 0.62, 34, INSCRIPTION_FONT);
    inscribe(g, S, '文王之商', 0.77, 0.62, 34, INSCRIPTION_FONT);
  }

  // 轻微模糊，得到柔和的铸造浮雕
  const hb = makeCanvas(S, S);
  const hbx = hb.getContext('2d');
  hbx.filter = 'blur(1.4px)';
  hbx.drawImage(hc, 0, 0);
  const gb = makeCanvas(S, S);
  const gbx = gb.getContext('2d');
  gbx.filter = 'blur(0.6px)';
  gbx.drawImage(gc, 0, 0);

  const noise = new ValueNoise(type === 'yong' ? 5 : 9);
  return composeBronze(S, S, hbx.getImageData(0, 0, S, S).data, gbx.getImageData(0, 0, S, S).data, noise, {
    freq: 5, seed: type === 'yong' ? 7 : 13, bottomPatina: true,
  });
}

// 通用青铜（甬、钩、铜人、灯、鼓座）
export function createBronzeTextures(seed = 21, patina = 0) {
  const S = 512;
  const noise = new ValueNoise(seed);
  // 用噪声生成铸造起伏
  const hdat = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = noise.fbm(x / S, y / S, 8, 4);
      const j = (y * S + x) * 4;
      hdat[j] = hdat[j + 1] = hdat[j + 2] = 110 + n * 40;
      hdat[j + 3] = 255;
    }
  }
  return composeBronze(S, S, hdat, null, noise, { freq: 4, seed, repeat: true, patina });
}

// ───────────────────────────── 漆木 ─────────────────────────────

export function createLacquerTexture({ base = '#140c0a', paint = '#a3281c', accent = '#c89a4a', seed = 31 } = {}) {
  const W = 2048;
  const H = 256;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  x.lineCap = 'round';
  x.lineJoin = 'round';
  // 上下朱色边线
  x.fillStyle = paint;
  x.fillRect(0, 10, W, 10);
  x.fillRect(0, H - 20, W, 10);
  x.fillStyle = accent;
  x.fillRect(0, 26, W, 3);
  x.fillRect(0, H - 29, W, 3);
  // 菱形纹 + 涡卷
  const unit = 256;
  const rnd = mulberry32(seed);
  for (let u = 0; u < W / unit; u++) {
    const cx = u * unit + unit / 2;
    const cy = H / 2;
    x.strokeStyle = paint;
    x.lineWidth = 7;
    x.beginPath();
    x.moveTo(cx - unit / 2 + 8, cy);
    x.lineTo(cx, 40);
    x.lineTo(cx + unit / 2 - 8, cy);
    x.lineTo(cx, H - 40);
    x.closePath();
    x.stroke();
    x.lineWidth = 3;
    x.strokeStyle = accent;
    x.beginPath();
    x.moveTo(cx - unit / 2 + 30, cy);
    x.lineTo(cx, 58);
    x.lineTo(cx + unit / 2 - 30, cy);
    x.lineTo(cx, H - 58);
    x.closePath();
    x.stroke();
    // 中心云纹
    x.strokeStyle = paint;
    x.lineWidth = 6;
    x.save();
    x.translate(cx - 42, cy - 26);
    cloudS(x, 0, 0, 84, 52, u % 2 === 0);
    x.restore();
    // 三角填朱
    x.fillStyle = paint;
    [[u * unit, 38, 1], [u * unit, H - 38, -1]].forEach(([tx, ty, d]) => {
      x.beginPath();
      x.moveTo(tx + 4, ty);
      x.lineTo(tx + unit / 2 - 14, ty);
      x.lineTo(tx + 4, ty + d * 70);
      x.closePath();
      x.globalAlpha = 0.85;
      x.fill();
      x.globalAlpha = 1;
    });
    // 小点饰
    x.fillStyle = accent;
    for (let k = 0; k < 4; k++) {
      x.beginPath();
      x.arc(cx + (rnd() - 0.5) * 60, cy + (rnd() - 0.5) * 40 + (k % 2 ? 50 : -50), 3, 0, Math.PI * 2);
      x.fill();
    }
  }
  // 漆面细微不均与磨损
  const img = x.getImageData(0, 0, W, H);
  const d = img.data;
  const noise = new ValueNoise(seed);
  const rough = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const j = (y * W + xx) * 4;
      const n = noise.fbm(xx / W, y / H, 16, 4, 2);
      const wear = smoothstep(0.62, 0.8, n);
      const f = 0.86 + n * 0.28;
      d[j] = d[j] * f * (1 - wear * 0.3);
      d[j + 1] = d[j + 1] * f * (1 - wear * 0.3);
      d[j + 2] = d[j + 2] * f * (1 - wear * 0.3);
      rough[j] = 255;
      rough[j + 1] = (0.2 + n * 0.18 + wear * 0.25) * 255;
      rough[j + 2] = 0;
      rough[j + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const map = toTexture(c, { srgb: true, repeat: true });
  const roughnessMap = toTexture(imageToCanvas(rough, W, H), { repeat: true });
  return { map, roughnessMap };
}

// ───────────────────────────── 地面 ─────────────────────────────

export function createFloorTextures() {
  const S = 1024;
  const noise = new ValueNoise(77);
  const rnd = mulberry32(77);
  const col = new Uint8ClampedArray(S * S * 4);
  const orm = new Uint8ClampedArray(S * S * 4);
  const bump = new Uint8ClampedArray(S * S * 4);
  const tiles = 4;
  const tileTone = [];
  for (let i = 0; i < tiles * tiles; i++) tileTone.push(rnd());
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const j = (y * S + x) * 4;
      const tx = (x / S) * tiles;
      const ty = (y / S) * tiles;
      const fx = tx - Math.floor(tx);
      const fy = ty - Math.floor(ty);
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      const grout = smoothstep(0.012, 0.004, edge);
      const tone = tileTone[Math.floor(ty) * tiles + Math.floor(tx)];
      const n = noise.fbm(x / S, y / S, 6, 5);
      const vein = Math.abs(noise.fbm(x / S, y / S, 3, 4) - 0.5);
      const veinL = smoothstep(0.03, 0.0, vein) * 0.4;
      const base = 20 + tone * 10 + n * 16 + veinL * 30;
      col[j] = mix(base * 1.08, 8, grout);
      col[j + 1] = mix(base * 0.96, 7, grout);
      col[j + 2] = mix(base * 0.86, 6, grout);
      col[j + 3] = 255;
      orm[j] = 255;
      orm[j + 1] = mix(0.18 + n * 0.3 + tone * 0.1, 0.9, grout) * 255;
      orm[j + 2] = 0;
      orm[j + 3] = 255;
      bump[j] = bump[j + 1] = bump[j + 2] = mix(0.5 + (n - 0.5) * 0.1, 0.15, grout) * 255;
      bump[j + 3] = 255;
    }
  }
  return {
    map: toTexture(imageToCanvas(col, S, S), { srgb: true, repeat: true }),
    ormMap: toTexture(imageToCanvas(orm, S, S), { repeat: true }),
    bumpMap: toTexture(imageToCanvas(bump, S, S), { repeat: true }),
  };
}

// ───────────────────────────── 殿堂墙面与窗棂 ─────────────────────────────

export function createWallTexture() {
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const noise = new ValueNoise(55);
  const img = x.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const j = (y * W + xx) * 4;
      const grain = noise.fbm(xx / W, y / H, 40, 4, 2);
      const panel = (xx % 256) < 6 || (y % 256) < 5 ? 0.55 : 1;
      const v = (24 + grain * 18) * panel;
      d[j] = v * 1.25; d[j + 1] = v * 0.72; d[j + 2] = v * 0.55; d[j + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return toTexture(c, { srgb: true, repeat: true });
}

export function createLatticeTexture() {
  const S = 512;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7);
  grd.addColorStop(0, '#fff3d6');
  grd.addColorStop(1, '#e8a860');
  x.fillStyle = grd;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = '#000';
  x.lineCap = 'square';
  // 步步锦窗棂
  x.lineWidth = 10;
  x.strokeRect(5, 5, S - 10, S - 10);
  x.lineWidth = 7;
  const n = 6;
  const step = S / n;
  for (let i = 1; i < n; i++) {
    x.beginPath();
    x.moveTo(i * step, 0); x.lineTo(i * step, S);
    x.moveTo(0, i * step); x.lineTo(S, i * step);
    x.stroke();
  }
  x.lineWidth = 4;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cx = i * step + step / 2;
      const cy = j * step + step / 2;
      x.strokeRect(cx - step * 0.22, cy - step * 0.22, step * 0.44, step * 0.44);
      x.beginPath();
      x.moveTo(cx - step * 0.22, cy); x.lineTo(i * step, cy);
      x.moveTo(cx + step * 0.22, cy); x.lineTo((i + 1) * step, cy);
      x.stroke();
    }
  }
  return toTexture(c, { srgb: true });
}

// ───────────────────────────── 建鼓鼓皮 ─────────────────────────────

export function createDrumSkinTexture() {
  const S = 512;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d');
  const noise = new ValueNoise(91);
  const img = x.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let xx = 0; xx < S; xx++) {
      const j = (y * S + xx) * 4;
      const n = noise.fbm(xx / S, y / S, 8, 5);
      d[j] = 196 + n * 40; d[j + 1] = 168 + n * 36; d[j + 2] = 120 + n * 30; d[j + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  x.translate(S / 2, S / 2);
  // 朱色日纹与云气
  x.strokeStyle = 'rgba(150,34,24,0.9)';
  x.lineWidth = 10;
  x.beginPath(); x.arc(0, 0, S * 0.46, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 4;
  x.beginPath(); x.arc(0, 0, S * 0.42, 0, Math.PI * 2); x.stroke();
  x.fillStyle = 'rgba(150,34,24,0.85)';
  x.beginPath(); x.arc(0, 0, S * 0.1, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(30,18,12,0.85)';
  x.lineWidth = 6;
  for (let k = 0; k < 8; k++) {
    x.save();
    x.rotate((k / 8) * Math.PI * 2);
    x.translate(S * 0.18, -S * 0.05);
    cloudS(x, 0, 0, S * 0.2, S * 0.1, k % 2 === 0);
    x.restore();
  }
  return toTexture(c, { srgb: true });
}

// 柔和光斑贴图（粒子 / 火焰）
export function createGlowTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return toTexture(c);
}

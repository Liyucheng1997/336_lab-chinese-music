// 编钟几何：合瓦形截面（两段圆弧相交的橄榄形）、弧形于口、尖锐铣棱、螺旋枚、甬与钮
// 单位钟：钟体高 1（舞部 y=0，铣角 y=-1），外部按实际尺寸统一缩放
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACE } from './textures.js';

const P = {
  aTop: 0.228, aBot: 0.318, // 半宽（铣间 / 2）
  bTop: 0.158, bBot: 0.218, // 半厚（鼓间 / 2）
  arch: 0.095, // 于口上弧高度
  thick: 0.02,
};

function dims(v, inset = 0) {
  const k = Math.pow(v, 0.92);
  const bulge = 1 + 0.035 * Math.sin(Math.PI * v);
  return {
    a: (P.aTop + (P.aBot - P.aTop) * k) * bulge - inset,
    b: (P.bTop + (P.bBot - P.bTop) * k) * bulge - inset,
  };
}

// 合瓦形截面上的一点：face 0 为正面（+z），s∈[0,1] 自左铣至右铣，按弧长均匀参数化
function lensXZ(a, b, s, face) {
  const R = (a * a + b * b) / (2 * b);
  const d = R - b;
  const phi = Math.asin(Math.min(1, a / R));
  const psi = phi * (2 * s - 1);
  const x = R * Math.sin(psi);
  const z = R * Math.cos(psi) - d;
  return face === 0 ? [x, z] : [-x, -z];
}

function yOf(s, v) {
  return -v + P.arch * Math.pow(Math.sin(Math.PI * s), 1.5) * Math.pow(v, 7);
}

export function surfacePoint(s, v, face = 0, inset = 0) {
  const { a, b } = dims(v, inset);
  const [x, z] = lensXZ(a, b, s, face);
  return new THREE.Vector3(x, yOf(s, v), z);
}

export function surfaceNormal(s, v, face = 0) {
  const e = 1e-3;
  const p = surfacePoint(s, v, face);
  const ps = surfacePoint(Math.min(1, s + e), v, face).sub(p);
  const pv = surfacePoint(s, Math.min(1, v + e), face).sub(p);
  return new THREE.Vector3().crossVectors(pv, ps).normalize();
}

function buildShell({ inset = 0, v0 = 0, inward = false, segS = 32, segV = 40 }) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let face = 0; face < 2; face++) {
    const base = pos.length / 3;
    for (let j = 0; j <= segV; j++) {
      const v = v0 + (1 - v0) * (j / segV);
      for (let i = 0; i <= segS; i++) {
        const s = i / segS;
        const p = surfacePoint(s, v, face, inset);
        pos.push(p.x, p.y, p.z);
        uv.push(s, 1 - v);
      }
    }
    const row = segS + 1;
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segS; i++) {
        const a = base + j * row + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        if (!inward) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 于口唇（内外壁之间的厚度）与舞部顶板
function buildRimAndTop(segS = 40) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let face = 0; face < 2; face++) {
    const base = pos.length / 3;
    for (let i = 0; i <= segS; i++) {
      const s = i / segS;
      const o = surfacePoint(s, 1, face, 0);
      const n = surfacePoint(s, 1, face, P.thick);
      pos.push(o.x, o.y, o.z, n.x, n.y, n.z);
      uv.push(s, 0.01, s, 0.0);
    }
    for (let i = 0; i < segS; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  // 舞部顶板（扇形三角化）
  const c = pos.length / 3;
  pos.push(0, 0, 0);
  uv.push(0.5, 0.99);
  for (let face = 0; face < 2; face++) {
    const base = pos.length / 3;
    for (let i = 0; i <= segS; i++) {
      const p = surfacePoint(i / segS, 0, face);
      pos.push(p.x, p.y, p.z);
      uv.push(i / segS, 0.995);
    }
    for (let i = 0; i < segS; i++) {
      idx.push(c, base + i, base + i + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 螺旋枚：层层收分的圆锥
function buildStud() {
  const prof = [
    [0.026, 0], [0.022, 0.004], [0.0195, 0.011], [0.0212, 0.015], [0.0185, 0.021], [0.0198, 0.025],
    [0.017, 0.031], [0.0135, 0.037], [0.008, 0.0415], [0.0, 0.0435],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(prof, 10);
}

function buildStuds() {
  const parts = [];
  const stud = buildStud();
  const up = new THREE.Vector3(0, 1, 0);
  for (let face = 0; face < 2; face++) {
    FACE.regions.forEach((R) => {
      FACE.rowCenters.forEach((v) => {
        FACE.colFracs.forEach((f) => {
          const s = R.x0 + (R.x1 - R.x0) * f;
          const p = surfacePoint(s, v, face);
          const n = surfaceNormal(s, v, face);
          const g = stud.clone();
          const q = new THREE.Quaternion().setFromUnitVectors(up, n);
          g.applyQuaternion(q);
          g.translate(p.x - n.x * 0.003, p.y - n.y * 0.003, p.z - n.z * 0.003);
          // 枚的纹理坐标落在钟面对应的枚座上
          const uvAttr = g.getAttribute('uv');
          for (let k = 0; k < uvAttr.count; k++) {
            uvAttr.setXY(k, s + (uvAttr.getX(k) - 0.5) * 0.05, 1 - v + (uvAttr.getY(k) - 0.5) * 0.04);
          }
          parts.push(g);
        });
      });
    });
  }
  return mergeGeometries(parts);
}

// 返回钟体几何（组 0：钟面材质；组 1：内壁 / 口沿 / 舞部）
export function buildBellBody(type) {
  const outer = buildShell({});
  const inner = buildShell({ inset: P.thick, v0: 0.04, inward: true, segS: 18, segV: 12 });
  const rim = buildRimAndTop(32);
  const list = [outer];
  if (type === 'yong') list.push(buildStuds());
  const innerMerged = mergeGeometries([inner, rim]);
  list.push(innerMerged);
  const g = mergeGeometries(list, true);
  // 合并时每个输入几何成为一组；把枚并入钟面材质
  g.groups.forEach((grp, i) => (grp.materialIndex = i === list.length - 1 ? 1 : 0));
  g.computeBoundingSphere();
  return g;
}

// 甬：带“旋”与“斡”的钟柄
export function buildYong() {
  const prof = [
    [0.0, 0], [0.098, 0], [0.084, 0.03], [0.074, 0.12], [0.071, 0.17],
    [0.088, 0.18], [0.09, 0.215], [0.072, 0.225], [0.066, 0.3], [0.058, 0.47],
    [0.064, 0.49], [0.066, 0.515], [0.05, 0.53], [0.0, 0.535],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const col = new THREE.LatheGeometry(prof, 20);
  // 斡：旋上的挂环（朝向演奏者一侧）
  const wo = new THREE.TorusGeometry(0.032, 0.011, 8, 18);
  wo.rotateY(Math.PI / 2);
  wo.translate(0, 0.2, 0.112);
  return mergeGeometries([col, wo]);
}

export const YONG_HANG = new THREE.Vector3(0, 0.2, 0.125); // 斡的挂点（单位钟坐标）

// 钮钟顶部的环钮
export function buildNiu() {
  const t = new THREE.TorusGeometry(0.075, 0.019, 10, 24, Math.PI);
  t.scale(1.15, 1.1, 1);
  const base = new THREE.CylinderGeometry(0.05, 0.07, 0.02, 16);
  base.translate(0, 0.01, 0);
  return mergeGeometries([t, base]);
}

export const BELL_PROPS = P;

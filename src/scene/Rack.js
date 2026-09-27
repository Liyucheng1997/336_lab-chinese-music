// 钟架（簨虡）：三层漆木横梁、青铜佩剑武士柱、钟钩与五十五件编钟
import * as THREE from 'three';
import { TIER_DEFS } from '../bells.js';
import { buildBellBody, buildYong, buildNiu, surfacePoint, surfaceNormal, YONG_HANG } from './bellGeometry.js';
import { FACE } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeStatic } from './merge.js';

export const HALF = 6.9; // 半跨度（米）
const BEAM = { lower: 2.06, middle: 3.58, upper: 4.39 };
const BEAM_H = 0.22;
const BEAM_D = 0.24;
const DAIS_H = 0.16;
const YONG_TILT = -0.26;
const GLOW = new THREE.Color(1.0, 0.58, 0.22);

// 青铜武士：双手与冠顶承托横梁
function makeFigure(height, mat, pedestal) {
  const g = new THREE.Group();
  const base = pedestal ? height * 0.1 : 0;
  if (pedestal) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.scale.set(height * 0.2, base, height * 0.2);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 40), mat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(height * 0.2);
    ring.position.y = height * 0.005;
    g.add(dome, ring);
    // 鼓座上盘绕的小龙（以扭结体概括）
    for (let i = 0; i < 8; i++) {
      const k = new THREE.Mesh(new THREE.TorusKnotGeometry(0.05, 0.016, 40, 6, 2, 3), mat);
      const a = (i / 8) * Math.PI * 2;
      k.position.set(Math.cos(a) * height * 0.075, base * 0.55, Math.sin(a) * height * 0.075);
      k.scale.setScalar(height * 0.35);
      k.rotation.set(Math.random() * 3, a, Math.random() * 3);
      g.add(k);
    }
  }
  const body = new THREE.Group();
  body.position.y = base;
  const H = height - base;
  body.scale.setScalar(H);
  g.add(body);

  const prof = [
    [0, 0], [0.17, 0], [0.176, 0.02], [0.152, 0.08], [0.128, 0.25], [0.106, 0.42], [0.098, 0.47],
    [0.108, 0.5], [0.118, 0.6], [0.128, 0.68], [0.132, 0.72], [0.1, 0.745], [0.046, 0.76], [0.04, 0.79], [0, 0.79],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const robe = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), mat);
  robe.scale.z = 0.8;
  body.add(robe);
  // 衣襟交领
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 20, Math.PI), mat);
  collar.position.set(0, 0.72, 0.035);
  collar.rotation.set(Math.PI * 0.62, 0, Math.PI);
  body.add(collar);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.103, 0.014, 8, 28), mat);
  belt.rotation.x = Math.PI / 2;
  belt.scale.y = 0.8;
  belt.position.y = 0.47;
  body.add(belt);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.066, 20, 14), mat);
  head.position.y = 0.835;
  head.scale.set(0.95, 1.08, 1);
  body.add(head);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 16), mat);
  crown.position.y = 0.94;
  body.add(crown);
  const crownTop = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.1), mat);
  crownTop.position.y = 0.99;
  body.add(crownTop);
  // 佩剑
  const sword = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.36, 0.022), mat);
  sword.position.set(-0.12, 0.38, 0.06);
  sword.rotation.set(0.1, 0, -0.45);
  body.add(sword);
  // 双臂上举
  const limb = (a, b, r) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    body.add(m);
  };
  for (const sx of [-1, 1]) {
    const sh = new THREE.Vector3(0.118 * sx, 0.705, 0);
    const el = new THREE.Vector3(0.2 * sx, 0.82, 0.02);
    const ha = new THREE.Vector3(0.1 * sx, 0.975, 0.01);
    limb(sh, el, 0.038);
    limb(el, ha, 0.03);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), mat);
    hand.position.copy(ha);
    body.add(hand);
  }
  g.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return g;
}

export class Rack {
  constructor(scene, specs, tex) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.specs = specs;
    this.bells = [];
    this.pickables = [];

    const bronze = new THREE.MeshStandardMaterial({
      map: tex.bronze.map, roughnessMap: tex.bronze.ormMap, metalnessMap: tex.bronze.ormMap,
      bumpMap: tex.bronze.bumpMap, bumpScale: 1.2, metalness: 1, roughness: 1, envMapIntensity: 1.1,
    });
    this.bronze = bronze;
    const lacquerMat = (repeatX) => {
      const map = tex.lacquer.map.clone();
      const rm = tex.lacquer.roughnessMap.clone();
      [map, rm].forEach((t) => { t.repeat.set(repeatX, 1); t.needsUpdate = true; });
      return new THREE.MeshPhysicalMaterial({
        map, roughnessMap: rm, roughness: 1, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.18, envMapIntensity: 0.9,
      });
    };

    this.#buildFrame(bronze, lacquerMat, tex);
    mergeStatic(this.group);
    this.#buildBells(bronze, tex);
  }

  #buildFrame(bronze, lacquerMat, tex) {
    const len = HALF * 2 + 0.9;
    // 台基
    const dais = new THREE.Mesh(new THREE.BoxGeometry(len + 1.6, DAIS_H, 2.4), lacquerMat((len + 1.6) / 3.2));
    dais.position.set(0, DAIS_H / 2, 0.1);
    dais.receiveShadow = true;
    dais.castShadow = true;
    this.group.add(dais);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(len + 1.64, 0.025, 2.44), bronze);
    trim.position.set(0, DAIS_H, 0.1);
    this.group.add(trim);

    // 三层横梁 + 青铜套头
    const beamMat = lacquerMat(len / 2.4);
    Object.entries(BEAM).forEach(([k, y]) => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(len, BEAM_H, BEAM_D), beamMat);
      beam.position.set(0, y, 0);
      beam.castShadow = true;
      beam.receiveShadow = true;
      this.group.add(beam);
      for (const sx of [-1, 1]) {
        const cap = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, BEAM_H + 0.06, BEAM_D + 0.06), bronze);
        const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 6), bronze);
        knob.rotation.z = Math.PI / 2;
        knob.position.x = sx * 0.26;
        const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 24), bronze);
        ringA.rotation.y = Math.PI / 2;
        ringA.position.x = -sx * 0.18;
        ringA.scale.set(1, 1.05, 1.1);
        cap.add(box, knob, ringA);
        cap.position.set(sx * (len / 2 - 0.15), y, 0);
        cap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this.group.add(cap);
      }
      // 梁上青铜箍
      for (const x of [-HALF, 0, HALF]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, BEAM_H + 0.03, BEAM_D + 0.03), bronze);
        band.position.set(x, y, 0);
        this.group.add(band);
      }
    });

    // 青铜武士柱：下层立于台基，中层与上层立于下一层横梁之上
    const tiers = [
      { y0: DAIS_H, y1: BEAM.lower - BEAM_H / 2, ped: true },
      { y0: BEAM.lower + BEAM_H / 2, y1: BEAM.middle - BEAM_H / 2, ped: false },
      { y0: BEAM.middle + BEAM_H / 2, y1: BEAM.upper - BEAM_H / 2, ped: false },
    ];
    tiers.forEach((t) => {
      for (const x of [-HALF, 0, HALF]) {
        const f = makeFigure(t.y1 - t.y0, bronze, t.ped);
        f.position.set(x, t.y0, 0);
        f.rotation.y = x === 0 ? 0 : x < 0 ? 0.25 : -0.25;
        this.group.add(f);
      }
    });
  }

  #layoutTier(tierDef, list) {
    const out = [];
    const m0 = 0.42;
    const m1 = 0.5;
    const groups = [list.filter((b) => b.group === 0), list.filter((b) => b.group === 1)];
    groups.forEach((g, gi) => {
      const lo = gi === 0 ? -HALF + m1 : m0;
      const hi = gi === 0 ? -m0 : HALF - m1;
      const L = hi - lo;
      const widths = g.map((b) => b.scale * 0.72);
      const sumW = widths.reduce((a, b) => a + b, 0);
      let gap;
      let start;
      if (tierDef.fill) {
        gap = (L - sumW) / g.length;
        start = lo + gap / 2;
      } else {
        gap = Math.min(tierDef.gap, (L - sumW) / (g.length - 1));
        const total = sumW + gap * (g.length - 1);
        start = lo + (L - total) / 2;
      }
      let x = start;
      g.forEach((b, i) => {
        out.push({ spec: b, x: x + widths[i] / 2 });
        x += widths[i] + gap;
      });
    });
    return out;
  }

  #buildBells(bronze, tex) {
    const bodyGeo = { yong: buildBellBody('yong'), niu: buildBellBody('niu') };
    const yongGeo = buildYong();
    const niuGeo = buildNiu();
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x4a2f1a, roughness: 0.75, metalness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.6,
    });
    const hookRod = new THREE.CylinderGeometry(0.012, 0.012, 1, 8);
    hookRod.translate(0, -0.5, 0);
    const hookEnd = new THREE.TorusGeometry(0.03, 0.009, 6, 14, Math.PI * 1.3);
    const hookPlate = new THREE.BoxGeometry(0.09, 0.03, 0.09);

    const byTier = TIER_DEFS.map((t) => this.specs.filter((s) => s.tier === t.key));
    TIER_DEFS.forEach((tierDef, ti) => {
      const placed = this.#layoutTier(tierDef, byTier[ti]);
      const beamBottom = BEAM[tierDef.key] - BEAM_H / 2;
      placed.forEach(({ spec, x }) => {
        const sc = spec.scale;
        const type = spec.type;
        const t = tex.face[type];
        const faceMat = new THREE.MeshStandardMaterial({
          map: t.map, roughnessMap: t.ormMap, metalnessMap: t.ormMap, bumpMap: t.bumpMap, bumpScale: 2.2,
          emissive: GLOW, emissiveMap: t.emissiveMap, emissiveIntensity: 0,
          metalness: 1, roughness: 1, envMapIntensity: 1.15,
        });
        // 每钟色泽略有差异
        const tint = 0.9 + ((spec.index * 37) % 17) / 100;
        faceMat.color.setRGB(tint, tint * (0.97 + ((spec.index * 13) % 7) / 100), tint * 0.95);

        const top = new THREE.Group(); // 挂点（梁底）
        top.position.set(x, beamBottom, 0);
        const swing = new THREE.Group();
        top.add(swing);

        const hookLen = type === 'yong' ? 0.36 * sc + 0.06 : 0.08;
        const rodG = hookRod.clone().scale(1, hookLen, 1);
        const endG = hookEnd.clone()
          .rotateZ(Math.PI * 0.85)
          .rotateY(type === 'yong' ? Math.PI / 2 : 0)
          .translate(0, -hookLen, 0);
        const hook = new THREE.Mesh(mergeGeometries([rodG, endG, hookPlate]), bronze);
        hook.castShadow = true;
        swing.add(hook);

        const hang = new THREE.Group();
        hang.position.y = -hookLen;
        swing.add(hang);
        const tilt = new THREE.Group();
        if (type === 'yong') tilt.rotation.x = YONG_TILT;
        hang.add(tilt);
        const holder = new THREE.Group();
        holder.scale.setScalar(sc);
        if (type === 'yong') holder.position.copy(YONG_HANG).multiplyScalar(-sc);
        else holder.position.y = -0.1 * sc;
        tilt.add(holder);

        const body = new THREE.Mesh(bodyGeo[type], [faceMat, innerMat]);
        body.castShadow = true;
        body.receiveShadow = true;
        body.userData.bell = spec.index;
        holder.add(body);
        const handle = new THREE.Mesh(type === 'yong' ? yongGeo : niuGeo, bronze);
        handle.castShadow = true;
        holder.add(handle);
        this.group.add(top);

        const strike = {
          main: { p: surfacePoint(FACE.strikeMain.s, FACE.strikeMain.v), n: surfaceNormal(FACE.strikeMain.s, FACE.strikeMain.v) },
          side: { p: surfacePoint(FACE.strikeSide.s, FACE.strikeSide.v), n: surfaceNormal(FACE.strikeSide.s, FACE.strikeSide.v) },
        };
        this.bells.push({
          spec, x, top, swing, holder, body, faceMat, strike,
          tier: tierDef.key,
          mass: sc,
          swingAmp: 0, swingT: -99, swingW: Math.sqrt(9.8 / (0.55 * sc + hookLen)),
          vib: 0, vibT: -99,
          glow: 0, hover: 0,
        });
        this.pickables.push(body);
      });
    });
    this.bells.sort((a, b) => a.spec.index - b.spec.index);
  }

  // 钟面上的击点（世界坐标）与外法线
  strikePoint(bell, tone) {
    const s = bell.strike[tone];
    bell.holder.updateWorldMatrix(true, false);
    const p = bell.holder.localToWorld(s.p.clone());
    const n = s.n.clone().transformDirection(bell.holder.matrixWorld);
    return { p, n };
  }

  center(bell) {
    bell.holder.updateWorldMatrix(true, false);
    return bell.holder.localToWorld(new THREE.Vector3(0, -0.55, 0));
  }

  // 钟被敲击：摆动、微振、错金纹饰发光
  excite(bell, vel, t) {
    const push = (0.05 * vel) / Math.pow(bell.mass, 0.8);
    bell.swingAmp = Math.min(0.14, bell.swingAmp * Math.exp(-(t - bell.swingT) * 1.3) + push);
    bell.swingT = t;
    bell.vib = Math.min(1, vel);
    bell.vibT = t;
    bell.glow = Math.min(4, bell.glow * 0.5 + 1.2 + vel * 2.2);
  }

  update(t, dt) {
    for (const b of this.bells) {
      const st = t - b.swingT;
      if (st >= 0 && b.swingAmp > 1e-4) {
        const a = b.swingAmp * Math.exp(-st * 1.3) * Math.sin(st * b.swingW);
        b.swing.rotation.x = a;
        b.swing.rotation.z = a * 0.12 * Math.sin(st * b.swingW * 0.7);
        if (st > 5) b.swingAmp = 0;
      }
      const vt = t - b.vibT;
      if (vt >= 0 && vt < 1.5) {
        const j = 0.006 * b.vib * Math.exp(-vt * 5) * Math.sin(vt * 2 * Math.PI * 22);
        b.holder.scale.set(b.mass * (1 + j), b.mass, b.mass * (1 - j));
      }
      b.glow *= Math.exp(-dt * 2.2);
      const target = b.glow + b.hover * 0.35;
      b.faceMat.emissiveIntensity = target < 0.003 ? 0 : target;
    }
  }
}

// 击钟工具：下层大钟用撞钟棒，中上层用丁字槌；按音频时间表驱动挥击动画
import * as THREE from 'three';

const APPROACH = 0.2; // 秒：挥槌至接触
const HOLD = 0.6; // 秒：回弹与淡出

function malletGeometry(kind) {
  const parts = [];
  if (kind === 'pole') {
    const shaft = new THREE.CylinderGeometry(0.042, 0.048, 1.9, 14);
    shaft.rotateX(Math.PI / 2);
    shaft.translate(0, 0, 0.95 + 0.08);
    const head = new THREE.CylinderGeometry(0.068, 0.068, 0.16, 18);
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, 0.08);
    const band1 = new THREE.CylinderGeometry(0.054, 0.054, 0.05, 14);
    band1.rotateX(Math.PI / 2);
    band1.translate(0, 0, 0.5);
    const band2 = band1.clone();
    band2.translate(0, 0, 0.8);
    parts.push([shaft, 'wood'], [head, 'head'], [band1, 'gold'], [band2, 'gold']);
  } else {
    const head = new THREE.CylinderGeometry(0.042, 0.042, 0.27, 16);
    head.rotateZ(Math.PI / 2);
    head.translate(0, 0, 0.042);
    const handle = new THREE.CylinderGeometry(0.015, 0.018, 0.62, 10);
    const dir = new THREE.Vector3(0, -0.55, 0.84).normalize();
    handle.translate(0, 0.31, 0);
    handle.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    handle.translate(0, 0, 0.042);
    const capL = new THREE.CylinderGeometry(0.045, 0.045, 0.024, 16);
    capL.rotateZ(Math.PI / 2);
    capL.translate(0.135, 0, 0.042);
    const capR = capL.clone();
    capR.translate(-0.27, 0, 0);
    parts.push([head, 'head'], [handle, 'wood'], [capL, 'gold'], [capR, 'gold']);
  }
  return parts;
}

class Mallet {
  constructor(kind, mats, scale) {
    this.group = new THREE.Group();
    this.kind = kind;
    this.mats = {
      wood: mats.wood.clone(),
      head: mats.head.clone(),
      gold: mats.gold.clone(),
    };
    Object.values(this.mats).forEach((m) => { m.transparent = true; m.opacity = 0; });
    for (const [geo, mk] of malletGeometry(kind)) {
      const mesh = new THREE.Mesh(geo, this.mats[mk]);
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    this.group.scale.setScalar(scale);
    this.group.visible = false;
    this.T = -99;
    this.start = -99;
    this.bell = null;
  }

  setOpacity(a) {
    Object.values(this.mats).forEach((m) => { m.opacity = a; m.depthWrite = a > 0.95; });
    this.group.visible = a > 0.01;
  }
}

export class Mallets {
  constructor(scene, rack, effects, tex) {
    this.rack = rack;
    this.effects = effects;
    this.group = new THREE.Group();
    scene.add(this.group);
    const wood = new THREE.MeshPhysicalMaterial({
      color: 0xc08a58, roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3,
    });
    const head = new THREE.MeshStandardMaterial({ color: 0xb03a22, roughness: 0.7, emissive: 0x3a0c04 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b060, roughness: 0.28, metalness: 1 });
    const mats = { wood, head, gold };
    this.pools = {
      lower: Array.from({ length: 6 }, () => new Mallet('pole', mats, 1)),
      middle: Array.from({ length: 10 }, () => new Mallet('mallet', mats, 1)),
      upper: Array.from({ length: 10 }, () => new Mallet('mallet', mats, 0.72)),
    };
    Object.values(this.pools).flat().forEach((m) => this.group.add(m.group));
    this.pending = [];
    this.drum = null;
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // 预排一次敲击（when 为音频时钟时间）
  schedule(bell, tone, vel, when, immediate = false) {
    this.pending.push({ bell, tone, vel, when, immediate, started: false, hit: false });
  }

  scheduleDrum(type, vel, when) {
    this.pending.push({ drum: type, vel, when, started: true, hit: false });
  }

  // 在音频时钟到达 when 时执行视觉回调（编磬等）
  scheduleCall(when, fn) {
    this.pending.push({ call: fn, when, started: true, hit: false });
  }

  cancelAfter(t) {
    this.pending = this.pending.filter((e) => e.when <= t + 0.01);
  }

  #take(bell, tone, T) {
    const pool = this.pools[bell.tier];
    // 同一钟连续敲击（轮奏）沿用同一只槌
    let m = pool.find((k) => k.bell === bell && k.tone === tone && T - k.T < 0.5);
    if (!m) m = pool.reduce((a, b) => (a.T < b.T ? a : b));
    return m;
  }

  update(vt) {
    const keep = [];
    for (const e of this.pending) {
      if (e.drum || e.call) {
        if (vt >= e.when) {
          if (e.drum) this.drum?.hit(e.drum, e.vel, vt);
          else e.call(vt);
        } else keep.push(e);
        continue;
      }
      if (!e.started && vt >= e.when - APPROACH) {
        const m = this.#take(e.bell, e.tone, e.when);
        const prevT = m.bell === e.bell ? m.T : -99;
        m.bell = e.bell;
        m.tone = e.tone;
        m.T = e.when;
        m.vel = e.vel;
        // 快速反复时缩短挥槌距离
        m.reach = Math.min(1, Math.max(0.25, (e.when - prevT) / 0.4));
        m.start = e.immediate ? e.when : e.when - APPROACH;
        e.started = true;
      }
      if (!e.hit && vt >= e.when) {
        e.hit = true;
        const b = e.bell;
        this.rack.excite(b, e.vel, vt);
        const { p, n } = this.rack.strikePoint(b, e.tone);
        const size = b.spec.scale * 0.75;
        this.effects.ripple(this.rack.center(b), size, e.vel, vt);
        this.effects.ripple(this.rack.center(b), size * 0.8, e.vel * 0.7, vt, 0.16);
        this.effects.sparks(p, n, e.vel, b.tier === 'lower' ? 18 : 10);
        this.effects.flash(p.clone().addScaledVector(n, 0.4), e.vel, vt);
        this.onHit?.(b, e.tone, e.vel);
      }
      if (!e.hit) keep.push(e);
    }
    this.pending = keep;

    for (const pool of Object.values(this.pools)) {
      for (const m of pool) this.#animate(m, vt);
    }
  }

  #animate(m, vt) {
    const p = vt - m.T;
    if (!m.bell || vt < m.start || p > HOLD) {
      if (m.group.visible) m.setOpacity(0);
      return;
    }
    const { p: contact, n } = this.rack.strikePoint(m.bell, m.tone);
    const reach = (m.kind === 'pole' ? 0.45 : 0.3) * (m.reach ?? 1);
    let d;
    if (p < 0) d = reach * Math.pow(-p / APPROACH, 1.7);
    else d = reach * 0.7 * (1 - Math.exp(-p * 9));
    const fadeIn = m.start === m.T ? 1 : Math.min(1, (vt - m.start) / 0.07);
    const fadeOut = p > 0.22 ? Math.max(0, 1 - (p - 0.22) / (HOLD - 0.22)) : 1;
    m.setOpacity(fadeIn * fadeOut);

    // 局部 +Z 指向钟外（朝向演奏者），接触面在原点
    const z = n;
    this._x.crossVectors(this._up, z).normalize();
    this._y.crossVectors(z, this._x);
    this._m.makeBasis(this._x, this._y, z);
    m.group.quaternion.setFromRotationMatrix(this._m);
    if (m.kind !== 'pole') m.group.rotateX(-d * 1.6);
    else m.group.rotateY(Math.sin(p * 3) * 0.02);
    m.group.position.copy(contact).addScaledVector(z, d + 0.004);
  }
}

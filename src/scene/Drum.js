// 建鼓：青铜蟠龙鼓座、朱漆鼓身、羽葆，双桴交替击鼓
import * as THREE from 'three';
import { mergeStatic } from './merge.js';

export class Drum {
  constructor(scene, tex, effects) {
    this.effects = effects;
    const g = new THREE.Group();
    g.position.set(-8.75, 0, 2.3);
    g.rotation.y = 0.62;
    scene.add(g);
    this.group = g;

    const bronze = new THREE.MeshStandardMaterial({
      map: tex.bronze.map, roughnessMap: tex.bronze.ormMap, metalnessMap: tex.bronze.ormMap,
      bumpMap: tex.bronze.bumpMap, bumpScale: 1.2, metalness: 1, roughness: 1, envMapIntensity: 1.1,
    });
    const red = new THREE.MeshPhysicalMaterial({
      map: tex.drumBody.map, roughnessMap: tex.drumBody.roughnessMap, roughness: 1, clearcoat: 0.7, clearcoatRoughness: 0.2,
    });
    const skin = new THREE.MeshStandardMaterial({ map: tex.drumSkin, roughness: 0.75, emissive: 0xffa060, emissiveIntensity: 0 });
    this.skinMat = skin;

    // 鼓座：穹顶上盘绕群龙
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), bronze);
    dome.scale.y = 0.48;
    dome.castShadow = true;
    g.add(dome);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 48), bronze);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    g.add(rim);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 0.46 : 0.3;
      const k = new THREE.Mesh(new THREE.TorusKnotGeometry(0.06, 0.02, 48, 6, 2, 3), bronze);
      k.position.set(Math.cos(a) * r, 0.16 + (i % 2 ? 0.02 : 0.1), Math.sin(a) * r);
      k.rotation.set(i * 0.7, a, i * 1.3);
      k.scale.setScalar(i % 2 ? 1.1 : 0.85);
      k.castShadow = true;
      g.add(k);
    }

    // 建鼓柱
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.7, 16), red);
    pole.position.y = 1.9;
    pole.castShadow = true;
    g.add(pole);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 12), bronze);
    finial.position.y = 3.86;
    g.add(finial);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 8, 20), bronze);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 3.7;
    g.add(collar);

    // 羽葆：垂挂的彩色丝绦
    this.ribbons = [];
    const ribbonColors = [0xa8261c, 0xd4a04a, 0x6d1510, 0xc0392b, 0xe0b860, 0x8a1c14];
    for (let i = 0; i < 12; i++) {
      const geo = new THREE.PlaneGeometry(0.07, 1.3, 1, 8);
      geo.translate(0, -0.65, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: ribbonColors[i % ribbonColors.length], roughness: 0.6, side: THREE.DoubleSide,
      }));
      const a = (i / 12) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.09, 3.68, Math.sin(a) * 0.09);
      m.rotation.y = -a;
      m.rotation.z = 0.25;
      g.add(m);
      this.ribbons.push({ mesh: m, a, seed: i * 1.7 });
    }

    // 鼓身（腰鼓形），鼓面朝向演奏席
    const body = new THREE.Group();
    body.position.y = 2.05;
    g.add(body);
    this.body = body;
    const prof = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      prof.push(new THREE.Vector2(0.5 + 0.1 * Math.sin(Math.PI * t), -0.46 + 0.92 * t));
    }
    const barrel = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), red);
    barrel.rotation.x = Math.PI / 2;
    barrel.castShadow = true;
    body.add(barrel);
    this.heads = [];
    for (const s of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), skin);
      head.position.z = s * 0.462;
      if (s < 0) head.rotation.y = Math.PI;
      body.add(head);
      this.heads.push(head);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.022, 8, 48), bronze);
      hoop.position.z = s * 0.46;
      body.add(hoop);
      // 鼓钉
      const nails = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 8, 6), bronze, 36);
      const mtx = new THREE.Matrix4();
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2;
        mtx.makeTranslation(Math.cos(a) * 0.505, Math.sin(a) * 0.505, s * 0.43);
        nails.setMatrixAt(k, mtx);
      }
      body.add(nails);
    }

    // 双桴
    const stickMat = new THREE.MeshStandardMaterial({ color: 0x3a120c, roughness: 0.5 });
    const knobMat = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.6 });
    this.sticks = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.2, 1.74, 1.0);
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = side * 0.3;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.62, 10), stickMat);
      stick.rotation.x = Math.PI / 2;
      stick.position.z = -0.31;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), knobMat);
      knob.position.z = -0.62;
      pivot.add(stick, knob);
      g.add(pivot);
      return { pivot, side, t: -9, vel: 0 };
    });
    mergeStatic(g, (o) => o.material === bronze && o.parent === g);
    this.nextStick = 0;
    this.hitT = -9;
    this.hitVel = 0;
  }

  hit(type, vel, t) {
    const s = this.sticks[this.nextStick];
    this.nextStick = 1 - this.nextStick;
    s.t = t;
    s.vel = vel;
    if (type !== 'x') {
      this.hitT = t;
      this.hitVel = Math.max(vel, this.hitVel * Math.exp(-(t - this.hitT) * 6));
      const c = new THREE.Vector3(0, 2.05, 0.5).applyMatrix4(this.group.matrixWorld);
      if (type === 'D' || vel > 0.7) this.effects.ripple(c, 0.9, vel * 0.8, t);
    }
  }

  update(t) {
    const p = t - this.hitT;
    const k = p >= 0 && p < 1 ? this.hitVel * Math.exp(-p * 9) : 0;
    this.body.scale.set(1 + k * 0.012, 1 + k * 0.012, 1 - k * 0.02);
    this.body.position.x = Math.sin(p * 60) * k * 0.004;
    this.skinMat.emissiveIntensity = k * 0.35;
    for (const s of this.sticks) {
      const q = t - s.t;
      // 敲击：挥下再抬起
      const hit = q >= 0 && q < 0.6 ? Math.exp(-q * 11) * (0.55 + 0.45 * s.vel) : 0;
      s.pivot.rotation.x = -0.28 + Math.sin(t * 0.8 + s.side) * 0.02 + hit * 0.72;
    }
    for (const r of this.ribbons) {
      r.mesh.rotation.z = 0.22 + Math.sin(t * 0.9 + r.seed) * 0.05 + k * 0.08 * Math.sin(p * 20 + r.seed);
    }
  }
}

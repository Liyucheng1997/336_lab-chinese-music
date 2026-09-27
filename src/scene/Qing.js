// 编磬：两层磬架、倨句形石磬，击磬时摆动与微光
import * as THREE from 'three';
import { mergeStatic } from './merge.js';

// 磬的轮廓：顶边为钝角“倨句”，左为股（短而宽），右为鼓（长而窄），底边微凹
function stoneGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.4, -0.13);
  s.lineTo(0, 0);
  s.lineTo(0.64, -0.2);
  s.lineTo(0.655, -0.34);
  s.quadraticCurveTo(0.3, -0.26, 0.04, -0.21);
  s.quadraticCurveTo(-0.18, -0.26, -0.42, -0.37);
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, -0.055, 0.02, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.034, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 16,
  });
  g.translate(0, 0.055, -0.017); // 以悬孔为原点
  g.scale(1, 1.35, 1);
  g.computeVertexNormals();
  return g;
}

export const QING_STRIKE = new THREE.Vector3(0.56, -0.33, 0.024); // 鼓端下角（单位磬坐标）

export class Qing {
  constructor(scene, specs, tex) {
    this.specs = specs;
    const g = new THREE.Group();
    g.position.set(9.6, 0, 2.9);
    g.rotation.y = -0.55;
    scene.add(g);
    this.group = g;

    const bronze = new THREE.MeshStandardMaterial({
      map: tex.bronze.map, roughnessMap: tex.bronze.ormMap, metalnessMap: tex.bronze.ormMap,
      bumpMap: tex.bronze.bumpMap, bumpScale: 1.2, metalness: 1, roughness: 1, envMapIntensity: 1.1,
    });
    const lacquer = new THREE.MeshPhysicalMaterial({
      map: tex.lacquer.map, roughnessMap: tex.lacquer.roughnessMap, roughness: 1, clearcoat: 0.8, clearcoatRoughness: 0.2,
    });
    const L = 5.6;
    const frame = new THREE.Group();
    g.add(frame);
    // 立柱与兽形铜座
    for (const x of [-L / 2, L / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.9, 0.16), lacquer);
      post.position.set(x, 1.45, 0);
      post.castShadow = true;
      frame.add(post);
      const base = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), bronze);
      base.scale.y = 0.55;
      frame.add(base);
      base.position.set(x, 0, 0);
      for (let k = 0; k < 6; k++) {
        const kn = new THREE.Mesh(new THREE.TorusKnotGeometry(0.05, 0.016, 40, 6, 2, 3), bronze);
        const a = (k / 6) * Math.PI * 2;
        kn.position.set(x + Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2);
        kn.rotation.set(k, a, k * 2);
        frame.add(kn);
      }
      // 龙首柱头
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 8), bronze);
      head.rotation.z = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      head.position.set(x + Math.sign(x) * 0.3, 2.86, 0);
      const crest = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), bronze);
      crest.position.set(x, 2.93, 0);
      frame.add(head, crest);
    }
    const beamY = [1.42, 2.75];
    beamY.forEach((y) => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(L + 0.5, 0.14, 0.14), lacquer);
      beam.position.y = y;
      beam.castShadow = true;
      frame.add(beam);
    });
    mergeStatic(frame);

    const stoneMat = new THREE.MeshStandardMaterial({
      map: tex.stone.map, roughnessMap: tex.stone.roughnessMap, bumpMap: tex.stone.bumpMap, bumpScale: 1.5,
      roughness: 1, metalness: 0, emissive: new THREE.Color(1.0, 0.82, 0.55), emissiveIntensity: 0, envMapIntensity: 0.7,
    });
    const geo = stoneGeometry();
    const cordGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5);
    cordGeo.translate(0, -0.5, 0);
    const cordMat = new THREE.MeshStandardMaterial({ color: 0x6a1a12, roughness: 0.8 });

    this.stones = [];
    this.pickables = [];
    specs.forEach((sp) => {
      const n = 12;
      const x = -L / 2 + 0.3 + ((L - 0.6) * (sp.indexInTier + 0.5)) / n - 0.12;
      const pivot = new THREE.Group();
      pivot.position.set(x, beamY[sp.tier] - 0.07, sp.indexInTier % 2 ? 0.05 : -0.05);
      g.add(pivot);
      const cordLen = 0.08 + sp.scale * 0.06;
      const cord = new THREE.Mesh(cordGeo, cordMat);
      cord.scale.y = cordLen;
      pivot.add(cord);
      const mat = stoneMat.clone();
      mat.color.setRGB(0.78, 0.84, 0.8).multiplyScalar(0.92 + ((sp.index * 17) % 9) / 60);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(sp.scale);
      mesh.position.y = -cordLen;
      mesh.rotation.z = -0.1;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.qing = sp.index;
      pivot.add(mesh);
      this.pickables.push(mesh);
      this.stones.push({ spec: sp, pivot, mesh, mat, swingAmp: 0, swingT: -99, glow: 0, hover: 0 });
    });
  }

  pick(midi) {
    const s = this.specs[0].midi;
    const e = s + this.specs.length - 1;
    while (midi < s) midi += 12;
    while (midi > e) midi -= 12;
    return this.stones[midi - s];
  }

  pan() {
    return 0.62;
  }

  strikePoint(stone) {
    stone.mesh.updateWorldMatrix(true, false);
    const p = stone.mesh.localToWorld(QING_STRIKE.clone());
    const n = new THREE.Vector3(0, 0, 1).transformDirection(stone.mesh.matrixWorld);
    return { p, n };
  }

  center(stone) {
    stone.mesh.updateWorldMatrix(true, false);
    return stone.mesh.localToWorld(new THREE.Vector3(0.12, -0.26, 0));
  }

  excite(stone, vel, t) {
    stone.swingAmp = Math.min(0.2, stone.swingAmp * Math.exp(-(t - stone.swingT) * 1.5) + 0.07 * vel);
    stone.swingT = t;
    stone.glow = Math.min(2.2, stone.glow * 0.5 + 0.5 + vel * 1.2);
  }

  update(t, dt) {
    for (const s of this.stones) {
      const st = t - s.swingT;
      if (st >= 0 && s.swingAmp > 1e-4) {
        s.pivot.rotation.x = s.swingAmp * Math.exp(-st * 1.4) * Math.sin(st * 6.5);
        if (st > 5) s.swingAmp = 0;
      }
      s.glow *= Math.exp(-dt * 3);
      const e = s.glow + s.hover * 0.25;
      s.mat.emissiveIntensity = e < 0.003 ? 0 : e * 0.35;
    }
  }
}

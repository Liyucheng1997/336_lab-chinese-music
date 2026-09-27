// 殿堂：镜面石地、窗棂天光、朱漆立柱、青铜灯台与浮尘
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeStatic } from './merge.js';

const BlurReflectorShader = {
  name: 'BlurReflector',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.24;
      float b = 0.0035;
      c += texture2D(tDiffuse, uv + vec2(b, 0.0)).rgb * 0.13;
      c += texture2D(tDiffuse, uv - vec2(b, 0.0)).rgb * 0.13;
      c += texture2D(tDiffuse, uv + vec2(0.0, b * 1.6)).rgb * 0.13;
      c += texture2D(tDiffuse, uv - vec2(0.0, b * 1.6)).rgb * 0.13;
      c += texture2D(tDiffuse, uv + vec2(b, b) * 1.8).rgb * 0.06;
      c += texture2D(tDiffuse, uv - vec2(b, b) * 1.8).rgb * 0.06;
      c += texture2D(tDiffuse, uv + vec2(b, -b) * 1.8).rgb * 0.06;
      c += texture2D(tDiffuse, uv - vec2(b, -b) * 1.8).rgb * 0.06;
      gl_FragColor = vec4(c * color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

const ShaftShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float along = vUv.y;                // 1 = 窗口，0 = 地面
      float fade = smoothstep(0.0, 0.55, along) * smoothstep(1.0, 0.9, along);
      float facing = pow(abs(dot(vN, vV)), 2.2);
      float streak = 0.62 + 0.38 * sin(vUv.x * 43.0 + uTime * 0.25) * sin(vUv.x * 17.0 - uTime * 0.17 + along * 3.0);
      float a = fade * facing * streak * uOpacity;
      gl_FragColor = vec4(uColor * a, a);
    }
  `,
};

const DustShader = {
  vertexShader: /* glsl */ `
    attribute float aSeed;
    uniform float uTime;
    uniform float uSize;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      p.x += sin(uTime * 0.05 + aSeed * 40.0) * 0.7;
      p.y += sin(uTime * 0.037 + aSeed * 23.0) * 0.5;
      p.z += cos(uTime * 0.043 + aSeed * 31.0) * 0.6;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = min(uSize * (0.4 + aSeed) / -mv.z, 7.0);
      // 进入主光束（右上方投来）时更亮
      float lit = smoothstep(4.0, 0.0, length(p.xz - vec2(0.8, 1.5))) * 0.8 + 0.2;
      vAlpha = lit * (0.35 + 0.65 * abs(sin(uTime * 0.4 + aSeed * 60.0))) * smoothstep(2.0, 6.0, -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * vAlpha;
      gl_FragColor = vec4(uColor * a, a);
    }
  `,
};

export class Hall {
  constructor(stage, tex) {
    this.stage = stage;
    const scene = stage.scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uniforms = [];

    // 镜面反射（半分辨率 + 模糊），其上覆一层半透明石材
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.reflector = new Reflector(new THREE.PlaneGeometry(90, 90), {
      clipBias: 0.003,
      textureWidth: w * 0.5,
      textureHeight: h * 0.5,
      color: new THREE.Color(0.62, 0.58, 0.54),
      shader: BlurReflectorShader,
      multisample: 0,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.y = -0.002;
    this.group.add(this.reflector);
    stage.onResize = (W, H) => this.reflector.getRenderTarget().setSize(W * 0.5, H * 0.5);

    ['map', 'ormMap', 'bumpMap'].forEach((k) => tex.floor[k].repeat.set(14, 14));
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshStandardMaterial({
        map: tex.floor.map, roughnessMap: tex.floor.ormMap, bumpMap: tex.floor.bumpMap, bumpScale: 1.5,
        roughness: 1, metalness: 0, transparent: true, opacity: 0.8, envMapIntensity: 0.4,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.renderOrder = -1;
    this.floor = floor;
    this.group.add(floor);

    this.#walls(tex);
    this.#shafts();
    this.#lamps(tex);
    this.#dust(tex);
  }

  #walls(tex) {
    tex.wall.repeat.set(10, 4);
    const wallMat = new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.85, metalness: 0 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 18), wallMat);
    wall.position.set(0, 9, -7.5);
    wall.receiveShadow = true;
    this.group.add(wall);

    // 窗棂：高光透入
    const winMat = new THREE.MeshBasicMaterial({ map: tex.lattice, color: new THREE.Color(1.35, 1.1, 0.85), fog: false });
    this.windows = [-8.5, 0, 8.5].map((x) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), winMat);
      m.position.set(x, 8.6, -7.45);
      this.group.add(m);
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(3.9, 3.9, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x2a120c, roughness: 0.5 }),
      );
      frame.position.set(x, 8.6, -7.52);
      this.group.add(frame);
      return m;
    });

    // 朱漆立柱与石础
    const colMat = new THREE.MeshPhysicalMaterial({
      map: tex.column.map, roughnessMap: tex.column.roughnessMap, roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.25,
    });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.7 });
    [[-12.5, -5.2], [12.5, -5.2], [-17, 1.5], [17, 1.5]].forEach(([x, z]) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 18, 32), colMat);
      c.position.set(x, 9, z);
      c.castShadow = true;
      c.receiveShadow = true;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.45, 32), baseMat);
      b.position.set(x, 0.22, z);
      b.receiveShadow = true;
      this.group.add(c, b);
    });
    // 额枋
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(40, 0.8, 0.6), colMat);
    lintel.position.set(0, 12.2, -5.2);
    this.group.add(lintel);
  }

  #shafts() {
    this.shaftMats = [];
    [-8.5, 0, 8.5].forEach((x, i) => {
      const top = new THREE.Vector3(x, 8.6, -7.3);
      const bottom = new THREE.Vector3(x * 0.55 + 0.6, 0, 3.2 + (i === 1 ? 0.6 : 0));
      const dir = new THREE.Vector3().subVectors(top, bottom);
      const len = dir.length();
      const geo = new THREE.CylinderGeometry(1.25, 2.9, len, 40, 1, true);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: i === 1 ? 0.034 : 0.026 },
          uColor: { value: new THREE.Color(1.0, 0.78, 0.5) },
        },
        vertexShader: ShaftShader.vertexShader,
        fragmentShader: ShaftShader.fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(bottom).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m.renderOrder = 5;
      this.group.add(m);
      this.shaftMats.push(mat);
    });
  }

  #lamps(tex) {
    const bronze = new THREE.MeshStandardMaterial({
      map: tex.bronze.map, roughnessMap: tex.bronze.ormMap, metalnessMap: tex.bronze.ormMap,
      metalness: 1, roughness: 1, envMapIntensity: 1.1,
    });
    this.flames = [];
    [[-9.3, 4.4], [8.6, 3.8]].forEach(([x, z], i) => {
      const g = new THREE.Group();
      const prof = [
        [0, 0], [0.42, 0], [0.44, 0.05], [0.3, 0.1], [0.2, 0.16], [0.08, 0.3], [0.06, 0.5], [0.07, 0.55],
        [0.05, 0.6], [0.05, 1.3], [0.08, 1.34], [0.05, 1.38], [0.05, 1.62], [0.1, 1.64], [0.28, 1.7],
        [0.34, 1.76], [0.32, 1.78], [0.24, 1.72], [0.0, 1.72],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const stand = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), bronze);
      stand.castShadow = true;
      g.add(stand);
      // 灯盘上的蟠龙扭饰
      for (let k = 0; k < 6; k++) {
        const kn = new THREE.Mesh(new THREE.TorusKnotGeometry(0.04, 0.012, 32, 5, 2, 3), bronze);
        const a = (k / 6) * Math.PI * 2;
        kn.position.set(Math.cos(a) * 0.3, 1.73, Math.sin(a) * 0.3);
        g.add(kn);
      }
      g.position.set(x, 0, z);
      mergeStatic(g);
      this.group.add(g);

      const flameCore = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex.glow, color: new THREE.Color(3.2, 2.4, 1.3), blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      flameCore.scale.set(0.14, 0.3, 1);
      flameCore.position.set(x, 1.93, z);
      const flameHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex.glow, color: new THREE.Color(1.8, 0.75, 0.25), blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: 0.7, fog: false,
      }));
      flameHalo.scale.set(0.7, 0.9, 1);
      flameHalo.position.set(x, 1.95, z);
      const light = new THREE.PointLight(0xff9a48, 9, 0, 2);
      light.position.set(x, 2.05, z);
      this.group.add(flameCore, flameHalo, light);
      this.flames.push({ core: flameCore, halo: flameHalo, light, seed: i * 7.3 });
    });
  }

  #dust(tex) {
    const N = 1800;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 1] = Math.random() * 9;
      pos[i * 3 + 2] = -5 + Math.random() * 13;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 26 * Math.min(window.devicePixelRatio, 2) },
        uColor: { value: new THREE.Color(1.0, 0.8, 0.55).multiplyScalar(0.9) },
      },
      vertexShader: DustShader.vertexShader,
      fragmentShader: DustShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, this.dustMat);
    pts.renderOrder = 6;
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  setQuality(q) {
    this.reflector.visible = q === 'high';
    this.floor.material.opacity = q === 'high' ? 0.8 : 1;
    this.floor.material.transparent = q === 'high';
  }

  update(t) {
    this.shaftMats.forEach((m) => (m.uniforms.uTime.value = t));
    this.dustMat.uniforms.uTime.value = t;
    for (const f of this.flames) {
      const n = Math.sin(t * 13 + f.seed) * 0.5 + Math.sin(t * 7.3 + f.seed * 2) * 0.3 + Math.sin(t * 23 + f.seed) * 0.2;
      const k = 1 + n * 0.12;
      f.core.scale.set(0.14 * (2 - k), 0.3 * k, 1);
      f.halo.material.opacity = 0.62 + n * 0.12;
      f.light.intensity = 9 * (0.88 + n * 0.14);
    }
  }
}

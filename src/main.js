import * as THREE from 'three';
import { Stage } from './scene/Stage.js';
import { Hall } from './scene/Hall.js';
import { Rack } from './scene/Rack.js';
import { Effects } from './scene/Effects.js';
import { Mallets } from './scene/Mallets.js';
import { Drum } from './scene/Drum.js';
import { Qing } from './scene/Qing.js';
import {
  createBellFaceTextures, createBronzeTextures, createLacquerTexture, createFloorTextures,
  createWallTexture, createLatticeTexture, createDrumSkinTexture, createGlowTexture, createStoneTextures,
} from './scene/textures.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { Player } from './music/Player.js';
import { SONGS } from './music/songs.js';
import { createBellSpecs, buildPitchMap, createQingSpecs } from './bells.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

// ───────────────────────────── 载入 ─────────────────────────────
const loaderFill = $('loader-fill');
const loaderText = $('loader-text');
function progress(p, text) {
  loaderFill.style.width = `${Math.round(p * 100)}%`;
  if (text) loaderText.textContent = text;
}

const specs = createBellSpecs();
const pitchMap = buildPitchMap(specs);
const qingSpecs = createQingSpecs();
const stage = new Stage($('stage'));
const engine = new AudioEngine();

async function buildWorld() {
  const tex = {};
  const steps = [
    ['范铸甬钟纹饰', () => (tex.face = { yong: createBellFaceTextures('yong') })],
    ['范铸钮钟纹饰', () => (tex.face.niu = createBellFaceTextures('niu'))],
    ['调配青铜', () => (tex.bronze = createBronzeTextures(21))],
    ['髹漆描朱', () => {
      tex.lacquer = createLacquerTexture();
      tex.column = createLacquerTexture({ base: '#5e120d', paint: '#240805', accent: '#b8883e', seed: 41 });
      tex.drumBody = createLacquerTexture({ base: '#7a1812', paint: '#150806', accent: '#d4a04a', seed: 51 });
    }],
    ['铺设殿堂', () => {
      tex.floor = createFloorTextures();
      tex.wall = createWallTexture();
      tex.lattice = createLatticeTexture();
      tex.drumSkin = createDrumSkinTexture();
      tex.glow = createGlowTexture();
      tex.stone = createStoneTextures();
    }],
  ];
  for (let i = 0; i < steps.length; i++) {
    progress(0.04 + (i / steps.length) * 0.3, `${steps[i][0]}……`);
    await nextFrame();
    steps[i][1]();
  }
  progress(0.36, '架设钟虡……');
  await nextFrame();
  const hall = new Hall(stage, tex);
  const rack = new Rack(stage.scene, specs, tex);
  const effects = new Effects(stage.scene, stage.camera);
  const mallets = new Mallets(stage.scene, rack, effects, tex);
  const drum = new Drum(stage.scene, tex, effects);
  const qing = new Qing(stage.scene, qingSpecs, tex);
  mallets.drum = drum;
  stage.renderer.compile(stage.scene, stage.camera);
  return { hall, rack, effects, mallets, drum, qing };
}

const world = await buildWorld();
const { hall, rack, effects, mallets, drum, qing } = world;
const pickables = [...rack.pickables, ...qing.pickables];
if (import.meta.env.DEV) window.__bz = { stage, rack, qing, engine };

const fitView = () => {
  const panel = document.getElementById('songs');
  const w = window.innerWidth;
  stage.setViewShift(w > 900 ? Math.round((panel.offsetWidth + 22) / 2) : 0);
};
fitView();
window.addEventListener('resize', fitView);
document.querySelector('#songs h2').addEventListener('click', () => {
  document.getElementById('songs').classList.toggle('collapsed');
  fitView();
});

// 渲染循环（载入期间即开始，便于预热着色器）
let lastT = performance.now() / 1000;
let started = false;
const camIntro = { t0: 0, from: new THREE.Vector3(0, 5.8, 31), to: new THREE.Vector3(-0.4, 3.4, 20.2) };
stage.camera.position.copy(camIntro.from);

const allMidis = specs.flatMap((s) => [s.main, s.side]);
await engine.prepare(allMidis, qingSpecs.map((s) => s.midi), (p, label) => {
  const name = typeof label === 'number' ? `调律 · ${Math.round(p * 100)}%` : label;
  progress(0.4 + p * 0.6, `${name}……`);
});
progress(1, '钟虡已备');
$('enter-btn').hidden = false;

// ───────────────────────────── 演奏 ─────────────────────────────
const panOf = (spec) => Math.max(-0.85, Math.min(0.85, rack.bells[spec.index].x / 8.5));
let focus = new THREE.Vector3(0, 2.4, 0);
const focusTarget = new THREE.Vector3(0, 2.4, 0);

mallets.onHit = (bell) => {
  focusTarget.lerp(rack.center(bell), 0.12);
};

function strikeQing(stone, vel, when) {
  engine.strikeQing(stone.spec.midi, vel, when, qing.pan());
  mallets.scheduleCall(when, (vt) => {
    qing.excite(stone, vel, vt);
    const { p, n } = qing.strikePoint(stone);
    const c = qing.center(stone);
    effects.ripple(c, 0.12 + stone.spec.scale * 0.55, vel * 0.7, vt);
    effects.sparks(p, n, vel * 0.5, 6);
    focusTarget.lerp(c, 0.1);
  });
}

function strikeBell(spec, tone, vel, when, immediate = false) {
  engine.strikeBell(spec, tone, vel, when, panOf(spec));
  mallets.schedule(rack.bells[spec.index], tone, vel, when, immediate);
}

const player = new Player(engine, specs, pitchMap, {
  onBell: (spec, tone, vel, when) => strikeBell(spec, tone, vel, when),
  onDrum: (type, vel, when) => mallets.scheduleDrum(type, vel, when),
  onQing: (midi, vel, when) => strikeQing(qing.pick(midi), vel, when),
  onCancel: () => mallets.cancelAfter(engine.now),
  onEnd: () => {
    setPlayingUI(false);
    showCaption(currentSong?.title ?? '', '曲终');
  },
});

// ───────────────────────────── 界面 ─────────────────────────────
const btnPlay = $('btn-play');
const btnStop = $('btn-stop');
const progressEl = $('progress');
const progressFill = $('progress-fill');
const progressMarks = $('progress-marks');
const timeEl = $('time');
const nowTitle = $('now-title');
const caption = $('caption');
const scoreEl = $('score');
const scoreTrack = $('score-track');
let currentSong = null;
let comp = null;
let sectionIdx = -1;
let captionTimer = 0;
let cinematic = true;
let showScore = true;

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function showCaption(song, sec) {
  caption.querySelector('.cap-song').textContent = song;
  caption.querySelector('.cap-sec').textContent = sec;
  caption.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => caption.classList.remove('show'), 4200);
}

function setPlayingUI(on) {
  btnPlay.classList.toggle('playing', on);
  scoreEl.classList.toggle('show', showScore && !!comp);
}

const list = $('song-list');
SONGS.forEach((song) => {
  const card = document.createElement('div');
  card.className = 'song-card';
  card.dataset.id = song.id;
  const secs = song.sections.map((s) => s.name.split(' · ')[0]).join(' · ');
  card.innerHTML = `<div><span class="t">${song.title}</span><span class="s">${song.era}</span></div>
    <div class="d">${song.desc}</div><div class="m">${secs}</div>`;
  card.addEventListener('click', () => selectSong(song));
  list.appendChild(card);
});

function selectSong(song) {
  if (!started) return;
  if (currentSong === song) {
    togglePlay();
    return;
  }
  currentSong = song;
  comp = player.load(song);
  document.querySelectorAll('.song-card').forEach((c) => c.classList.toggle('active', c.dataset.id === song.id));
  nowTitle.textContent = `${song.title} · ${song.era}`;
  btnPlay.disabled = false;
  btnStop.disabled = false;
  progressMarks.innerHTML = '';
  comp.sections.forEach((s) => {
    const m = document.createElement('span');
    m.style.left = `${(s.t / comp.duration) * 100}%`;
    m.dataset.name = s.name;
    progressMarks.appendChild(m);
  });
  buildScore(comp.display);
  sectionIdx = -1;
  player.play();
  setPlayingUI(true);
}

function togglePlay() {
  if (!comp) return;
  if (player.playing) {
    player.pause();
    setPlayingUI(false);
  } else {
    player.play();
    setPlayingUI(true);
  }
}

btnPlay.addEventListener('click', togglePlay);
btnStop.addEventListener('click', () => {
  player.stop();
  engine.damp(0.6);
  setPlayingUI(false);
  sectionIdx = -1;
});
progressEl.addEventListener('click', (e) => {
  if (!comp) return;
  const r = progressEl.getBoundingClientRect();
  player.seek(((e.clientX - r.left) / r.width) * comp.duration);
  sectionIdx = -1;
});
$('rate').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  player.setRate(v);
  $('rate-val').textContent = `${v.toFixed(2)}×`;
});
$('volume').addEventListener('input', (e) => engine.setVolume(Number(e.target.value)));
const toggle = (id, fn) => $(id).addEventListener('click', (e) => {
  const on = e.currentTarget.classList.toggle('on');
  fn(on, e.currentTarget);
  e.currentTarget.blur();
});
// 按钮点击后释放焦点，避免空格键（击鼓）误触发按钮
document.querySelectorAll('#transport button').forEach((b) => b.addEventListener('click', () => b.blur()));
toggle('btn-cam', (on) => (cinematic = on));
toggle('btn-score', (on) => {
  showScore = on;
  scoreEl.classList.toggle('show', on && !!comp);
});
toggle('btn-quality', (on, el) => {
  el.textContent = on ? '高画质' : '流畅';
  stage.setQuality(on ? 'high' : 'low');
  hall.setQuality(on ? 'high' : 'low');
});

// ───────────────────────────── 简谱卷轴 ─────────────────────────────
let scoreItems = [];
let scoreDone = 0;
function buildScore(display) {
  scoreTrack.innerHTML = '';
  scoreItems = [];
  let x = 0;
  for (const d of display) {
    const el = document.createElement('div');
    el.className = 'jn';
    let w = 22;
    if (d.type === 'bar') {
      el.classList.add('bar');
      w = 14;
      el.style.left = `${x + 6}px`;
    } else if (d.type === 'dash') {
      el.classList.add('dash');
      el.textContent = '–';
      el.style.left = `${x + 11}px`;
    } else {
      let html = '';
      if (d.acc) html += `<span class="acc">${d.acc > 0 ? '♯' : '♭'}</span>`;
      html += d.degree;
      if (d.oct > 0) html += `<span class="up">${'•'.repeat(d.oct)}</span>`;
      const lines = Math.min(3, d.lines);
      const dnOffset = lines * 3;
      if (d.oct < 0) html += `<span class="dn" style="bottom:${-8 - dnOffset}px">${'•'.repeat(-d.oct)}</span>`;
      for (let k = 0; k < lines; k++) html += `<span class="ul" style="bottom:${-1 - k * 3}px"></span>`;
      if (d.dotted) html += '<span style="position:absolute;right:-6px;top:0">·</span>';
      el.innerHTML = html;
      el.style.left = `${x + 11}px`;
      w = d.lines >= 2 ? 16 : 22;
    }
    scoreTrack.appendChild(el);
    scoreItems.push({ el, t: d.t, x: x + 11, type: d.type });
    x += w;
  }
  scoreDone = 0;
  scoreLast = 0;
}
let scoreLast = 0;
function resetScore(time = 0) {
  scoreDone = 0;
  scoreItems.forEach((s) => {
    s.el.classList.remove('hit');
    const done = s.t <= time;
    s.el.classList.toggle('done', done);
    if (done) scoreDone++;
  });
  scoreLast = time;
}
function updateScore(time) {
  if (!scoreItems.length) return;
  // 跳转或重播：直接重算状态，不逐个播放高亮动画
  if (time < scoreLast - 0.2 || time > scoreLast + 1.5) resetScore(time);
  scoreLast = time;
  while (scoreDone < scoreItems.length && scoreItems[scoreDone].t <= time) {
    const it = scoreItems[scoreDone];
    if (it.type === 'note') {
      it.el.classList.add('hit');
      setTimeout(() => { it.el.classList.remove('hit'); it.el.classList.add('done'); }, 260);
    } else it.el.classList.add('done');
    scoreDone++;
  }
  let k = Math.max(0, scoreDone - 1);
  const a = scoreItems[k];
  const b = scoreItems[Math.min(scoreItems.length - 1, k + 1)];
  let x = a.x;
  if (b !== a && time > a.t) x = a.x + (b.x - a.x) * Math.min(1, (time - a.t) / Math.max(1e-3, b.t - a.t));
  if (time < scoreItems[0].t) x = scoreItems[0].x - (scoreItems[0].t - time) * 60;
  scoreTrack.style.transform = `translateX(${-x}px)`;
}

// ───────────────────────────── 交互：点击与键盘 ─────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = $('tooltip');
let hovered = null;
let downPos = null;
let lastInteract = -99;

function pickAt(clientX, clientY) {
  pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  if (!hit) return null;
  if (hit.object.userData.qing !== undefined) {
    return { stone: qing.stones[hit.object.userData.qing], target: qing.stones[hit.object.userData.qing] };
  }
  const bell = rack.bells[hit.object.userData.bell];
  const local = bell.holder.worldToLocal(hit.point.clone());
  const v = Math.min(1, Math.max(0, -local.y));
  const a = 0.228 + 0.09 * v;
  const tone = Math.abs(local.x) / a > 0.34 ? 'side' : 'main';
  return { bell, tone, v, target: bell };
}

function tooltipHTML(p) {
  if (p.stone) {
    const s = p.stone.spec;
    return `<div class="tt-name">${s.title}</div>
      <div class="tt-row"><span>编磬 · 石灰岩</span><b>${s.tier ? '上层' : '下层'}</b></div>
      <div class="tt-row on"><span>磬音</span><b>${s.name}</b></div>`;
  }
  const s = p.bell.spec;
  return `<div class="tt-name">${s.title}</div>
    <div class="tt-row"><span>${s.tierLabel}</span><b>${s.type === 'yong' ? '甬钟' : '钮钟'}</b></div>
    <div class="tt-row ${p.tone === 'main' ? 'on' : ''}"><span>正鼓音</span><b>${s.mainName}</b></div>
    <div class="tt-row ${p.tone === 'side' ? 'on' : ''}"><span>侧鼓音</span><b>${s.sideName}</b></div>`;
}

const canvas = $('stage');
canvas.addEventListener('pointermove', (e) => {
  if (!started) return;
  const p = pickAt(e.clientX, e.clientY);
  if (hovered && (!p || p.target !== hovered)) hovered.hover = 0;
  hovered = p?.target ?? null;
  if (p) {
    p.target.hover = 1;
    tooltip.innerHTML = tooltipHTML(p);
    tooltip.style.left = `${e.clientX}px`;
    tooltip.style.top = `${e.clientY}px`;
    tooltip.classList.add('show');
    canvas.style.cursor = 'pointer';
  } else {
    tooltip.classList.remove('show');
    canvas.style.cursor = '';
  }
});
canvas.addEventListener('pointerleave', () => {
  if (hovered) hovered.hover = 0;
  hovered = null;
  tooltip.classList.remove('show');
});
canvas.addEventListener('pointerdown', (e) => {
  downPos = [e.clientX, e.clientY];
  lastInteract = performance.now() / 1000;
});
canvas.addEventListener('wheel', () => (lastInteract = performance.now() / 1000), { passive: true });
canvas.addEventListener('pointerup', (e) => {
  if (!started || !downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 6) return;
  const p = pickAt(e.clientX, e.clientY);
  if (!p) return;
  if (p.stone) {
    strikeQing(p.stone, 0.8, engine.now);
    return;
  }
  // 击点越靠下（鼓部）越响
  const vel = 0.55 + 0.4 * Math.min(1, Math.max(0, (p.v - 0.3) / 0.6));
  strikeBell(p.bell.spec, p.tone, vel, engine.now, true);
});

const KEYMAP = {};
['z', 'x', 'c', 'v', 'b', 'n', 'm'].forEach((k, i) => (KEYMAP[k] = [48, i]));
['a', 's', 'd', 'f', 'g', 'h', 'j'].forEach((k, i) => (KEYMAP[k] = [60, i]));
['q', 'w', 'e', 'r', 't', 'y', 'u'].forEach((k, i) => (KEYMAP[k] = [72, i]));
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
window.addEventListener('keydown', (e) => {
  if (!started || e.repeat || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    engine.strikeDrum('D', 0.85);
    mallets.scheduleDrum('D', 0.85, engine.now);
    return;
  }
  // 数字键 1–7：编磬（1 = C5）
  const digit = /^Digit([1-7])$/.exec(e.code);
  if (digit) {
    strikeQing(qing.pick(72 + MAJOR[Number(digit[1]) - 1] + (e.shiftKey ? 1 : 0)), 0.8, engine.now);
    return;
  }
  const km = KEYMAP[e.key.toLowerCase()];
  if (!km) return;
  const midi = km[0] + MAJOR[km[1]] + (e.shiftKey ? 1 : 0);
  const pick = player.pickBell(midi, engine.now);
  if (pick) strikeBell(pick.spec, pick.tone, 0.78, engine.now, true);
});

// ───────────────────────────── 开场 ─────────────────────────────
$('enter-btn').addEventListener('click', async () => {
  await engine.resume();
  $('loader').classList.add('hide');
  started = true;
  camIntro.t0 = performance.now() / 1000;
  // 开场：自低至高的一串钟声
  const now = engine.now + 0.6;
  [36, 43, 48, 55, 60, 64, 67, 72, 76, 79, 84].forEach((m, i) => {
    const pick = player.pickBell(m, now + i * 0.16);
    if (pick) strikeBell(pick.spec, pick.tone, 0.5 + i * 0.03, now + i * 0.16);
  });
  engine.strikeDrum('D', 0.7, now);
  mallets.scheduleDrum('D', 0.7, now);
});

// ───────────────────────────── 主循环 ─────────────────────────────
const tmpPos = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const tNow = performance.now() / 1000;
  const dt = Math.min(0.05, tNow - lastT);
  lastT = tNow;
  const vt = engine.visualTime;

  mallets.update(vt);
  rack.update(vt, dt);
  effects.update(vt, dt);
  drum.update(vt);
  qing.update(vt, dt);
  hall.update(tNow);

  // 开场运镜
  if (started && !camIntro.done) {
    const k = Math.min(1, (tNow - camIntro.t0) / 5.5);
    const e = 1 - Math.pow(1 - k, 3);
    stage.camera.position.lerpVectors(camIntro.from, camIntro.to, e);
    stage.controls.target.set(0, 2.35, 0);
    lastInteract = tNow - 1;
    if (k >= 1) camIntro.done = true;
  } else if (!started) {
    const a = tNow * 0.05;
    stage.camera.position.set(Math.sin(a) * 4, 5.8, 31);
  }

  // 演奏中的自动运镜：缓慢环绕并追随击钟位置
  focus.lerp(focusTarget, dt * 0.8);
  focusTarget.lerp(new THREE.Vector3(0, 2.4, 0), dt * 0.15);
  if (started && cinematic && player.playing && tNow - lastInteract > 4) {
    const t = tNow;
    const ang = Math.sin(t * 0.045) * 0.36 + focus.x * 0.018;
    const rad = 15.5 + 3 * Math.sin(t * 0.031);
    const hgt = 2.9 + 1.0 * Math.sin(t * 0.057 + 1);
    tmpTarget.set(focus.x * 0.4, 2.2 + (focus.y - 2.4) * 0.35, 0);
    tmpPos.set(tmpTarget.x + Math.sin(ang) * rad, hgt, Math.cos(ang) * rad);
    stage.camera.position.lerp(tmpPos, dt * 0.35);
    stage.controls.target.lerp(tmpTarget, dt * 0.5);
  }
  stage.controls.update();

  if (comp) {
    const time = player.time;
    progressFill.style.width = `${Math.min(100, (time / comp.duration) * 100)}%`;
    timeEl.textContent = `${fmt(Math.max(0, time))} / ${fmt(comp.duration)}`;
    if (player.playing) {
      let si = 0;
      comp.sections.forEach((s, i) => { if (time >= s.t - 0.05) si = i; });
      if (si !== sectionIdx) {
        sectionIdx = si;
        showCaption(currentSong.title, comp.sections[si].name);
      }
      updateScore(time);
    }
  }
  stage.render(tNow);
}
frame();

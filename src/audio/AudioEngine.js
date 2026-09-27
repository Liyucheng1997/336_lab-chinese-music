// 音频引擎：预渲染钟声样本、立体声定位、殿堂混响、动态处理
import { renderBellTone, renderDrum } from './synth.js';
import { midiToFreq } from '../music/theory.js';

const MAX_VOICES = 110;

export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.buffers = new Map();
    this.drums = {};
    this.voices = [];
    this.byBell = new Map();
    this.#buildGraph();
  }

  #buildGraph() {
    const c = this.ctx;
    this.input = c.createGain(); // 干声总线
    this.send = c.createGain(); // 混响发送
    this.preDelay = c.createDelay(0.2);
    this.preDelay.delayTime.value = 0.022;
    this.convolver = c.createConvolver();
    this.wet = c.createGain();
    this.wet.gain.value = 0.32;
    this.master = c.createGain();
    this.master.gain.value = 0.8;

    const warm = c.createBiquadFilter();
    warm.type = 'lowshelf';
    warm.frequency.value = 170;
    warm.gain.value = 2.5;
    const air = c.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 9000;
    air.gain.value = -2;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.28;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;

    this.input.connect(this.master);
    this.send.connect(this.preDelay).connect(this.convolver).connect(this.wet).connect(this.master);
    this.master.connect(warm).connect(air).connect(comp).connect(limiter).connect(this.analyser).connect(c.destination);
  }

  // 预渲染：钟声样本 + 鼓 + 混响脉冲响应
  async prepare(midis, onProgress) {
    const sr = this.ctx.sampleRate;
    const list = [...new Set(midis)].sort((a, b) => a - b);
    const total = list.length + 5;
    let done = 0;
    const tick = async (label) => {
      done++;
      onProgress?.(done / total, label);
      await new Promise((r) => setTimeout(r, 0));
    };

    this.convolver.buffer = await this.#makeImpulse(3.6);
    await tick('殿堂混响');

    for (const [i, t] of ['D', 'd', 'r', 'x'].entries()) {
      this.drums[t] = this.#toBuffer(renderDrum(t, sr, 11 + i));
      await tick('建鼓');
    }
    for (const m of list) {
      this.buffers.set(m, this.#toBuffer(renderBellTone(midiToFreq(m), sr, m * 131 + 7)));
      await tick(m);
    }
  }

  #toBuffer(data) {
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.copyToChannel(data, 0);
    return b;
  }

  // 程序化殿堂混响：早期反射 + 频率相关衰减的扩散尾音
  async #makeImpulse(seconds) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(seconds * sr);
    const off = new OfflineAudioContext(2, len, sr);
    const noise = off.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = noise.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp((-6.9 * t) / seconds) * Math.min(1, t / 0.012);
        d[i] = (Math.random() * 2 - 1) * env * 0.5;
      }
      // 早期反射（殿堂墙面与梁柱）
      [0.011, 0.019, 0.027, 0.038, 0.047, 0.061, 0.074].forEach((t, k) => {
        const idx = Math.floor((t + (ch ? 0.0023 * k : 0)) * sr);
        if (idx < len) d[idx] += (0.55 - k * 0.06) * (ch ? 0.9 : 1);
      });
    }
    const src = off.createBufferSource();
    src.buffer = noise;
    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(8500, 0);
    lp.frequency.exponentialRampToValueAtTime(900, seconds);
    const hp = off.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    src.connect(lp).connect(hp).connect(off.destination);
    src.start();
    return off.startRendering();
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  get now() {
    return this.ctx.currentTime;
  }

  // 视觉同步时间：扣除输出延迟，使画面与耳朵听到的声音对齐
  get visualTime() {
    const c = this.ctx;
    return c.currentTime - (c.outputLatency || 0) - (c.baseLatency || 0);
  }

  setVolume(v) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setReverb(mix) {
    this.wet.gain.setTargetAtTime(mix, this.ctx.currentTime, 0.4);
  }

  // 敲钟：tone 'main' 正鼓 / 'side' 侧鼓；另一音以微弱音量同时激发（一钟双音的串音）
  strikeBell(spec, tone, vel, when = this.ctx.currentTime, pan = 0) {
    const c = this.ctx;
    const midi = tone === 'side' ? spec.side : spec.main;
    const other = tone === 'side' ? spec.main : spec.side;
    const buf = this.buffers.get(midi);
    if (!buf) return;
    when = Math.max(when, c.currentTime);

    // 再次敲击同一钟：木槌接触会吸收部分余振
    const prev = this.byBell.get(spec.index);
    if (prev) {
      prev.forEach((v) => {
        if (v.end > when) {
          v.gain.gain.cancelScheduledValues(when);
          v.gain.gain.setTargetAtTime(v.level * 0.3, when, 0.025);
        }
      });
    }

    const freq = midiToFreq(midi);
    const level = Math.min(1.2, vel * Math.pow(freq / 262, -0.16) * 0.9);

    const out = c.createGain();
    out.gain.value = level;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400 + 15000 * Math.pow(vel, 1.7);
    lp.Q.value = 0.4;
    const p = c.createStereoPanner();
    p.pan.value = pan;

    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(lp);
    let src2 = null;
    const ob = this.buffers.get(other);
    if (ob) {
      src2 = c.createBufferSource();
      src2.buffer = ob;
      const g2 = c.createGain();
      g2.gain.value = 0.09;
      src2.connect(g2).connect(lp);
      src2.start(when);
    }
    lp.connect(out).connect(p);
    p.connect(this.input);
    p.connect(this.send);
    src.start(when);

    const voice = { src, src2, gain: out, level, start: when, end: when + buf.duration, bell: spec.index, nodes: [lp, out, p] };
    this.#track(voice);
    src.onended = () => this.#release(voice);
  }

  strikeDrum(type, vel, when = this.ctx.currentTime) {
    const c = this.ctx;
    const buf = this.drums[type];
    if (!buf) return;
    when = Math.max(when, c.currentTime);
    const g = c.createGain();
    g.gain.value = vel * (type === 'x' ? 0.55 : 1.05);
    const p = c.createStereoPanner();
    p.pan.value = -0.55;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.03;
    src.connect(g).connect(p);
    p.connect(this.input);
    p.connect(this.send);
    src.start(when);
    const voice = { src, gain: g, level: vel, start: when, end: when + buf.duration, bell: -1, nodes: [g, p] };
    this.#track(voice);
    src.onended = () => this.#release(voice);
  }

  #track(voice) {
    this.voices.push(voice);
    if (voice.bell >= 0) {
      if (!this.byBell.has(voice.bell)) this.byBell.set(voice.bell, new Set());
      this.byBell.get(voice.bell).add(voice);
    }
    // 复音数超限时淡出最早的声部
    if (this.voices.length > MAX_VOICES) {
      const old = this.voices[0];
      const t = this.ctx.currentTime;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0, t, 0.03);
      try { old.src.stop(t + 0.2); old.src2?.stop(t + 0.2); } catch { /* 已停止 */ }
    }
  }

  #release(voice) {
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
    this.byBell.get(voice.bell)?.delete(voice);
    voice.nodes.forEach((n) => n.disconnect());
  }

  // 取消尚未发声的预排音符（暂停 / 跳转时）
  cancelFuture() {
    const t = this.ctx.currentTime;
    this.voices.slice().forEach((v) => {
      if (v.start > t + 0.005) {
        try { v.src.stop(); v.src2?.stop(); } catch { /* 未开始 */ }
        this.#release(v);
      }
    });
  }

  // 全部止音（停止演奏）
  damp(time = 0.35) {
    const t = this.ctx.currentTime;
    this.voices.forEach((v) => {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, time / 3);
    });
  }
}

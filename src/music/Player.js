// 演奏调度器：提前量调度（lookahead），支持变速、暂停、跳转
import { compileSong } from './notation.js';

const LOOKAHEAD = 0.32; // 秒：给木槌挥动留出预备时间
const INTERVAL = 25;

export class Player {
  constructor(engine, specs, pitchMap, handlers) {
    this.engine = engine;
    this.specs = specs;
    this.pitchMap = pitchMap;
    this.h = handlers; // { onBell(spec, tone, vel, when), onDrum(type, vel, when), onEnd() }
    this.song = null;
    this.comp = null;
    this.playing = false;
    this.rate = 1;
    this.pos = 0;
    this.idx = 0;
    this.lastUse = new Float64Array(specs.length).fill(-10);
    this.minMidi = Math.min(...pitchMap.keys());
    this.maxMidi = Math.max(...pitchMap.keys());
  }

  load(song) {
    this.stop();
    this.song = song;
    this.comp = compileSong(song);
    this.engine.setReverb(song.reverb ?? 0.32);
    return this.comp;
  }

  get duration() {
    return this.comp?.duration ?? 0;
  }

  // 当前乐曲时间（秒，按原速计）
  get time() {
    if (!this.playing) return this.pos;
    return this.#songAt(this.engine.visualTime);
  }

  #songAt(ctxTime) {
    return this.anchorSong + (ctxTime - this.anchorCtx) * this.rate;
  }

  #ctxAt(songTime) {
    return this.anchorCtx + (songTime - this.anchorSong) / this.rate;
  }

  play() {
    if (!this.comp || this.playing) return;
    if (this.pos >= this.duration - 0.5) this.pos = 0;
    this.anchorCtx = this.engine.now + 0.15;
    this.anchorSong = this.pos;
    this.idx = this.#indexAt(this.pos);
    this.playing = true;
    this.timer = setInterval(() => this.#tick(), INTERVAL);
    this.#tick();
  }

  pause() {
    if (!this.playing) return;
    this.pos = Math.max(0, this.#songAt(this.engine.now));
    this.playing = false;
    clearInterval(this.timer);
    this.engine.cancelFuture();
    this.h.onCancel?.();
  }

  stop() {
    if (this.playing) this.pause();
    this.pos = 0;
    this.idx = 0;
  }

  seek(t) {
    const was = this.playing;
    if (was) this.pause();
    this.pos = Math.max(0, Math.min(t, this.duration));
    this.idx = this.#indexAt(this.pos);
    if (was) this.play();
  }

  setRate(r) {
    if (this.playing) {
      const now = this.engine.now;
      this.anchorSong = this.#songAt(now);
      this.anchorCtx = now;
    }
    this.rate = r;
  }

  #indexAt(t) {
    const ev = this.comp.events;
    let lo = 0;
    let hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ev[mid].t < t - 1e-4) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  #tick() {
    const ev = this.comp.events;
    const now = this.engine.now;
    const horizon = this.#songAt(now + LOOKAHEAD);
    while (this.idx < ev.length && ev[this.idx].t <= horizon) {
      const e = ev[this.idx++];
      const when = Math.max(this.#ctxAt(e.t), now);
      if (e.kind === 'drum') {
        this.engine.strikeDrum(e.drum, e.vel, when);
        this.h.onDrum?.(e.drum, e.vel, when);
      } else if (e.kind === 'qing') {
        this.h.onQing?.(e.midi, e.vel, when);
      } else {
        const pick = this.pickBell(e.midi, when);
        if (pick) this.h.onBell(pick.spec, pick.tone, e.vel, when);
      }
    }
    if (this.#songAt(now) >= this.duration) {
      this.playing = false;
      clearInterval(this.timer);
      this.pos = this.duration;
      this.h.onEnd?.();
    }
  }

  // 选钟：优先正鼓音；同一钟刚被敲过时换用可发同音的另一钟（侧鼓），使快速同音反复更自然
  pickBell(midi, when) {
    while (midi < this.minMidi) midi += 12;
    while (midi > this.maxMidi) midi -= 12;
    let cands = this.pitchMap.get(midi);
    if (!cands) cands = this.pitchMap.get(midi - 12) ?? this.pitchMap.get(midi + 12);
    if (!cands) return null;
    let best = null;
    let bestScore = Infinity;
    for (const c of cands) {
      const since = when - this.lastUse[c.bell];
      let score = c.tone === 'main' ? 0 : 0.6;
      if (since < 0.14) score += 1.2;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    this.lastUse[best.bell] = when;
    return { spec: this.specs[best.bell], tone: best.tone };
  }
}

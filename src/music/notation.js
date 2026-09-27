// 简谱文本解析器
//
//   音符   1–7（0 为休止），前缀 # / b 升降半音
//   八度   ' 高八度，, 低八度（可叠加：1'' 、5,,）
//   时值   默认一拍；_ 减半（八分），= 四分之一（十六分），可叠加；. 附点
//   延长   -  上一音延长一拍
//   轮奏   *n 在该音时值内均匀敲击 n 次（模拟琵琶轮指 / 筝摇指）
//   重音   !
//   和音   a+b+c 同时敲击；前缀 ~ 为自下而上的琶音（刮奏）
//   倚音   ^n 装饰音，落在下一个音之前
//   力度   pp p mp mf f ff
//   鼓     D 重击  d 中击  x 击边  R 滚奏
//   反复   ( ... )x2
//   小节线 |（仅用于排版和乐谱卷轴显示）

import { MAJOR } from './theory.js';

const DYN = { ppp: 0.2, pp: 0.3, p: 0.42, mp: 0.54, mf: 0.66, f: 0.8, ff: 0.92, fff: 1.0 };
const NOTE_RE = /^([#b]?)([0-7]|[DdxR])([',]*)([_=]*)(\.?)(?:\*(\d+))?(!?)$/;

function expandRepeats(src) {
  let s = src;
  const re = /\(([^()]*)\)x(\d+)/g;
  while (re.test(s)) {
    s = s.replace(re, (_, body, n) => Array(Number(n)).fill(body).join(' '));
  }
  return s;
}

function parseNote(str) {
  const m = NOTE_RE.exec(str);
  if (!m) throw new Error(`无法解析的简谱记号：“${str}”`);
  const [, acc, sym, octs, durs, dot, trem, accent] = m;
  let dur = 1;
  for (const c of durs) dur *= c === '_' ? 0.5 : 0.25;
  if (dot) dur *= 1.5;
  let oct = 0;
  for (const c of octs) oct += c === "'" ? 1 : -1;
  const isDrum = /[DdxR]/.test(sym);
  return {
    isDrum,
    drum: isDrum ? sym : null,
    degree: isDrum ? 0 : Number(sym),
    oct,
    acc: acc === '#' ? 1 : acc === 'b' ? -1 : 0,
    dur,
    lines: [...durs].reduce((n, c) => n + (c === '_' ? 1 : 2), 0),
    dotted: !!dot,
    trem: trem ? Number(trem) : 0,
    accent: !!accent,
  };
}

function parseTrack(text, key, trackName, withDisplay) {
  const tokens = expandRepeats(text).split(/\s+/).filter(Boolean);
  let beat = 0;
  let dyn = DYN.mf;
  let lastGroup = null;
  let pendingGrace = [];
  const events = [];
  const display = [];

  for (const tok of tokens) {
    if (tok === '|') {
      if (withDisplay) display.push({ beat, type: 'bar' });
      continue;
    }
    if (DYN[tok] !== undefined) { dyn = DYN[tok]; continue; }
    if (tok === '-') {
      if (lastGroup) lastGroup.forEach((e) => (e.dur += 1));
      if (withDisplay) display.push({ beat, type: 'dash' });
      beat += 1;
      continue;
    }
    if (tok.startsWith('^')) {
      pendingGrace.push(parseNote(tok.slice(1)));
      continue;
    }

    const arp = tok.startsWith('~');
    const parts = (arp ? tok.slice(1) : tok).split('+').map(parseNote);
    const head = parts[0];
    const group = [];

    parts.forEach((p, i) => {
      if (!p.isDrum && p.degree === 0) return; // 休止
      const ev = {
        beat, dur: head.dur, track: trackName,
        kind: p.isDrum ? 'drum' : 'bell',
        drum: p.drum,
        midi: p.isDrum ? 0 : key + MAJOR[p.degree - 1] + 12 * p.oct + p.acc,
        vel: Math.min(1, dyn + (p.accent ? 0.16 : 0)),
        trem: p.trem,
        offset: arp ? i * 0.038 : 0,
      };
      group.push(ev);
      events.push(ev);
    });

    if (group.length && pendingGrace.length) {
      pendingGrace.forEach((g, k) => {
        events.push({
          beat, dur: 0.25, track: trackName, kind: 'bell', trem: 0,
          midi: key + MAJOR[g.degree - 1] + 12 * g.oct + g.acc,
          vel: dyn * 0.62,
          offset: -(pendingGrace.length - k) * 0.075,
          grace: true,
        });
      });
    }
    pendingGrace = [];

    if (withDisplay) {
      display.push({
        beat, type: 'note', degree: head.isDrum ? 0 : head.degree,
        oct: head.oct, acc: head.acc, lines: head.lines, dotted: head.dotted,
      });
    }
    lastGroup = group.length ? group : null;
    beat += head.dur;
  }
  return { events, display, length: beat };
}

// 节拍 → 秒，支持段末渐快 / 渐慢
function makeTimeMap(sec, length) {
  const T = sec.tempo;
  const T2 = sec.tempoTo ?? T;
  const rampBeats = sec.ramp === 'all' ? length : Math.min(sec.ramp ?? 0, length);
  const r0 = length - rampBeats;
  return (b) => {
    if (T2 === T || rampBeats <= 0 || b <= r0) return (b * 60) / T;
    const base = (r0 * 60) / T;
    const x = Math.min(b - r0, rampBeats);
    const tx = T + ((T2 - T) * x) / rampBeats;
    let s = base + ((60 * rampBeats) / (T2 - T)) * Math.log(tx / T);
    if (b - r0 > rampBeats) s += ((b - r0 - rampBeats) * 60) / T2;
    return s;
  };
}

// 可复现的伪随机
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function compileSong(song) {
  const rand = rng(song.id.length * 7919 + 17);
  const events = [];
  const display = [];
  const sections = [];
  let t0 = 0;

  song.sections.forEach((sec, si) => {
    const key = sec.key ?? song.key;
    const parsed = Object.entries(sec.tracks).map(([name, text]) =>
      parseTrack(text, key, name, name === 'm'));
    const length = Math.max(...parsed.map((p) => p.length));
    const toSec = makeTimeMap(sec, length);
    sections.push({ name: sec.name, t: t0, index: si });

    for (const p of parsed) {
      for (const ev of p.events) {
        const start = t0 + toSec(ev.beat) + ev.offset;
        const end = t0 + toSec(ev.beat + ev.dur) + ev.offset;
        if (ev.kind === 'drum' && ev.drum === 'R') {
          // 滚奏：渐强的连续轻击
          const n = Math.max(3, Math.round((end - start) / 0.058));
          for (let k = 0; k < n; k++) {
            const f = k / (n - 1);
            events.push({
              t: start + (k * (end - start)) / n, kind: 'drum', drum: k % 2 ? 'r' : 'd',
              vel: ev.vel * (0.38 + 0.5 * f) * (0.9 + 0.2 * rand()), track: ev.track,
            });
          }
        } else if (ev.trem > 1) {
          for (let k = 0; k < ev.trem; k++) {
            events.push({
              ...ev,
              t: start + (k * (end - start)) / ev.trem,
              vel: ev.vel * (k === 0 ? 1 : 0.72 + 0.18 * rand()),
            });
          }
        } else {
          events.push({ ...ev, t: Math.max(0, start) });
        }
      }
    }
    for (const p of parsed) {
      for (const d of p.display) display.push({ ...d, t: t0 + toSec(d.beat), section: si });
    }
    t0 += toSec(length);
  });

  events.sort((a, b) => a.t - b.t);
  events.forEach((e) => { delete e.beat; delete e.offset; delete e.trem; });
  return { events, display, sections, duration: t0 + 4 };
}

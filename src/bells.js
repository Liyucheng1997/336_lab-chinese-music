// 编钟音列设计：三层五十五钟，每钟“一钟双音”（正鼓音 + 侧鼓音）
import { midiName, zengName } from './music/theory.js';

export const TIER_DEFS = [
  { key: 'lower', label: '下层 · 大型甬钟', type: 'yong', start: 36, count: 12, groups: [6, 6], gap: 0.24, fill: true },
  { key: 'middle', label: '中层 · 甬钟', type: 'yong', start: 48, count: 24, groups: [12, 12], gap: 0.12, fill: false },
  { key: 'upper', label: '上层 · 钮钟', type: 'niu', start: 72, count: 19, groups: [10, 9], gap: 0.1, fill: false },
];

const DIATONIC = new Set([0, 2, 4, 5, 7, 9, 11]);

// 钟体高度（米）随音高降低：大钟约 1 米，最小钮钟约 0.25 米
export function bellScale(midi) {
  return 1.0 * Math.pow(2, (-(midi - 36) / 12) * 0.45);
}

// 侧鼓音与正鼓音相距大三度或小三度（曾侯乙钟的典型双音结构），尽量落在自然音上
function sideOf(main) {
  return DIATONIC.has((main + 4) % 12) ? main + 4 : main + 3;
}

export function createBellSpecs() {
  const specs = [];
  TIER_DEFS.forEach((tier, tierIndex) => {
    for (let i = 0; i < tier.count; i++) {
      const main = tier.start + i;
      const side = sideOf(main);
      const group = i < tier.groups[0] ? 0 : 1;
      specs.push({
        index: specs.length,
        tier: tier.key,
        tierIndex,
        tierLabel: tier.label,
        indexInTier: i,
        group,
        type: tier.type,
        main,
        side,
        scale: bellScale(main),
        mainName: `${zengName(main)} · ${midiName(main)}`,
        sideName: `${zengName(side)} · ${midiName(side)}`,
        title: `${tier.label.split(' · ')[0]}第${i + 1}钟`,
      });
    }
  });
  return specs;
}

// 音高 → 可发此音的钟（正鼓或侧鼓）
export function buildPitchMap(specs) {
  const map = new Map();
  const add = (midi, bell, tone) => {
    if (!map.has(midi)) map.set(midi, []);
    map.get(midi).push({ bell, tone });
  };
  specs.forEach((b) => {
    add(b.main, b.index, 'main');
    add(b.side, b.index, 'side');
  });
  return map;
}

// 编磬：两层二十四磬，半音排列（C4–B5）
export const QING_RANGE = { start: 60, count: 24 };

export function createQingSpecs() {
  const out = [];
  for (let i = 0; i < QING_RANGE.count; i++) {
    const midi = QING_RANGE.start + i;
    out.push({
      index: i,
      midi,
      tier: i < 12 ? 0 : 1,
      indexInTier: i % 12,
      scale: 0.64 * Math.pow(2, (-(midi - 60) / 12) * 0.5),
      name: `${zengName(midi)} · ${midiName(midi)}`,
      title: `${i < 12 ? '下' : '上'}层第${(i % 12) + 1}磬`,
    });
  }
  return out;
}

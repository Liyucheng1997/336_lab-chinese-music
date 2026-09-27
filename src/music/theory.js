// 乐律工具：音名、曾侯乙阶名、频率

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// 曾侯乙钟铭的阶名体系（以宫 = C 计）：
// “角”为其上大三度，“曾”为其下大三度，由此得到十二个半音的名称。
const ZENG = ['宫', '羽角', '商', '徵曾', '角', '羽曾', '商角', '徵', '宫曾', '羽', '商曾', '徵角'];

export const midiName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const zengName = (m) => ZENG[((m % 12) + 12) % 12];
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 大调音阶的半音偏移，用于简谱 1–7
export const MAJOR = [0, 2, 4, 5, 7, 9, 11];

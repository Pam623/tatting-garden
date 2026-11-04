// Compares two independent readings of a chart, element by element.
import { parseToken } from './pattern.js';

// Picot names are private to each reader, so a join is compared by which of the
// target's left picots it lands on, not by what the reader called it.
function readAll(transcription) {
  if (!Array.isArray(transcription.elements) || transcription.elements.length === 0) {
    throw new Error('没有任何元素');
  }
  const seen = new Set();
  transcription.elements.forEach((element) => {
    if (typeof element.id !== 'string' || element.id === '') throw new Error('有元素没有名字');
    if (seen.has(element.id)) throw new Error(`${element.id} 重复了`);
    seen.add(element.id);
    if (!['ring', 'bridge'].includes(element.type)) throw new Error(`${element.id} 的类型无效`);
    if (!Array.isArray(element.parts)) throw new Error(`${element.id} 没有内容`);
    if (element.flip !== undefined && typeof element.flip?.value !== 'boolean') throw new Error(`${element.id} 的翻面写法无效`);
  });
  const leftOrder = new Map();
  transcription.elements.forEach((element) => {
    const left = element.parts.map(parseToken).filter((p) => p.kind === 'leave').map((p) => p.name);
    leftOrder.set(element.id, left);
  });
  return transcription.elements.map((element) => ({
    id: element.id,
    type: element.type,
    flip: element.flip?.value ?? null,
    parts: element.parts.map(parseToken).map((part) => ({
      ...part,
      key: partKey(part, leftOrder, element.id),
    })),
  }));
}

function partKey(part, leftOrder, owner) {
  if (part.kind === 'stitch') return String(part.count);
  if (part.kind === 'deco') return '○';
  if (part.kind === 'leave') return ',';
  const ordinal = (leftOrder.get(part.element) ?? []).indexOf(part.name) + 1;
  if (ordinal === 0) throw new Error(`${owner} 接到的 ${part.element}.${part.name} 不存在`);
  return `→${part.element}#${ordinal}`;
}

const formula = (parts) => parts.map((p) => p.key).join(' ');
const flipText = (flip) => (flip === null ? '没说' : flip ? '翻' : '不翻');

export function compareTranscriptions(a, b) {
  const left = readAll(a);
  const right = readAll(b);
  const differences = [];
  const notes = [];
  const rightIds = right.map((e) => e.id);
  const leftIds = left.map((e) => e.id);

  leftIds.filter((id) => !rightIds.includes(id)).forEach((id) => differences.push({ id, text: `${id}：只有第一份有` }));
  rightIds.filter((id) => !leftIds.includes(id)).forEach((id) => differences.push({ id, text: `${id}：只有第二份有` }));

  const shared = leftIds.filter((id) => rightIds.includes(id));
  const sharedRight = rightIds.filter((id) => leftIds.includes(id));
  if (shared.join() !== sharedRight.join()) {
    differences.push({ id: null, text: `顺序不同：${shared.join(' ')} 和 ${sharedRight.join(' ')}` });
  }

  shared.forEach((id) => {
    const x = left.find((e) => e.id === id);
    const y = right.find((e) => e.id === id);
    if (x.type !== y.type) differences.push({ id, text: `${id}：类型不同，${x.type} 和 ${y.type}` });
    if (formula(x.parts) !== formula(y.parts)) {
      differences.push({ id, text: `${id}：内容不同，${formula(x.parts)} 和 ${formula(y.parts)}` });
    } else {
      x.parts.forEach((part, index) => {
        if (part.source !== y.parts[index].source) {
          notes.push(`${id} 第 ${index + 1} 段：数字相同，把握程度不同（${part.source} 和 ${y.parts[index].source}）`);
        } else if (part.error !== y.parts[index].error) {
          notes.push(`${id} 第 ${index + 1} 段：数字相同，误差不同（${part.error ?? '没写'} 和 ${y.parts[index].error ?? '没写'}）`);
        }
      });
    }
    if (x.flip !== null && y.flip !== null && x.flip !== y.flip) {
      differences.push({ id, text: `${id}：翻面不同，${flipText(x.flip)} 和 ${flipText(y.flip)}` });
    } else if (x.flip !== y.flip) {
      notes.push(`${id}：只有一份说了翻面（${flipText(x.flip)} 和 ${flipText(y.flip)}）`);
    }
  });

  return { match: differences.length === 0, differences, notes, compared: shared.length };
}

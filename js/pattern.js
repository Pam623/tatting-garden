// Reads a pattern file: turns part tokens into items, and checks the numbers agree.
//
// Parts:  "5"         work 5 stitches
//         "o"         decorative picot
//         "p:first"   leave a join picot, named so another element can join to it
//         "p:mid+"    the same, for a picot that takes several joins
//         "j:A.last"  join to picot "last" of element A
//
// Any part may end in a source mark: "?" inferred, "~" estimated from a photo.
// A stitch estimate may give its error: "16~3" is 16 plus or minus 3.

const TIERS = ['reconstruction', 'sorted', 'checked', 'made'];
const RIGHTS = ['original', 'public-domain', 'private'];
const TYPES = ['ring', 'bridge'];
const SOURCES = ['source', 'inferred', 'estimated'];

function sourceOf(mark) {
  if (!mark) return 'source';
  return mark === '?' ? 'inferred' : 'estimated';
}

export function parseToken(token) {
  const text = String(token);
  let match = text.match(/^(\d+)(\?|~(\d+)?)?$/);
  if (match) {
    const part = { kind: 'stitch', count: Number(match[1]), source: sourceOf(match[2]?.[0]) };
    if (match[3] !== undefined) part.error = Number(match[3]);
    return part;
  }
  match = text.match(/^o(\?|~)?$/);
  if (match) return { kind: 'deco', source: sourceOf(match[1]) };
  match = text.match(/^p:([^+?~.]+)(\+)?(\?|~)?$/);
  if (match) return { kind: 'leave', name: match[1], multi: Boolean(match[2]), source: sourceOf(match[3]) };
  match = text.match(/^j:([^.]+)\.([^+?~.]+)(\?|~)?$/);
  if (match) return { kind: 'join', element: match[1], name: match[2], source: sourceOf(match[3]) };
  throw new Error(`Unknown part: ${text}`);
}

// Stitches and picots along an element. Picots sit at the stitch count reached so far.
export function readElement(element) {
  let at = 0;
  const items = element.parts.map((token) => {
    const item = { ...parseToken(token), from: at };
    if (item.kind === 'stitch') at += item.count;
    item.to = at;
    return item;
  });
  return { id: element.id, type: element.type, group: element.group, items, stitches: at };
}

export function numberText(item) {
  if (item.source === 'inferred') return `${item.count}?`;
  if (item.source === 'estimated') return item.error === undefined ? `≈${item.count}` : `≈${item.count}±${item.error}`;
  return String(item.count);
}

function unitOf(pattern, elementId) {
  return pattern.elements.find((e) => e.id === elementId)?.type === 'bridge' ? '桥' : '环';
}

function picotText(item) {
  const mark = item.kind === 'deco' ? '○' : ',';
  return item.source === 'source' ? mark : `${mark}${item.source === 'inferred' ? '?' : '≈'}`;
}

// The founder's notation: 2,4,3,4○2 where a comma is a join picot and ○ a decorative one.
export function handFormula(element) {
  return readElement(element).items
    .map((item) => (item.kind === 'stitch' ? numberText(item) : picotText(item)))
    .join('');
}

function plainFormula(element) {
  return readElement(element).items
    .map((item) => (item.kind === 'stitch' ? String(item.count) : item.kind === 'deco' ? '○' : ','))
    .join('');
}

function hasUncertainty(element) {
  return readElement(element).items.some((item) => item.source !== 'source');
}

// One row per type and formula, so identical elements read as one line of the stitch table.
export function formulaGroups(pattern) {
  const groups = new Map();
  pattern.elements.forEach((element) => {
    const formula = plainFormula(element);
    const key = `${element.type}|${formula}`;
    if (!groups.has(key)) {
      groups.set(key, {
        type: element.type, formula, members: [], stitches: readElement(element).stitches, estimated: false,
      });
    }
    if (readElement(element).items.some((item) => item.source === 'estimated')) groups.get(key).estimated = true;
    groups.get(key).members.push({ id: element.id, unsure: hasUncertainty(element) });
  });
  return [...groups.values()];
}

export function summarize(pattern) {
  const rings = pattern.elements.filter((e) => e.type === 'ring');
  const bridges = pattern.elements.filter((e) => e.type === 'bridge');
  const ringFormulas = new Set(rings.map(plainFormula));
  const parts = [`${rings.length} 环`, `${bridges.length} 桥`];
  if (ringFormulas.size === 1) {
    const estimated = rings.some((ring) => readElement(ring).items.some((item) => item.source === 'estimated'));
    parts.push(`每环${estimated ? '约 ' : ' '}${readElement(rings[0]).stitches} 针`);
  }
  return parts.join(' · ');
}

// The ordinal of a join picot among those its element left, counted the way it was worked.
function picotOrdinal(pattern, elementId, name) {
  const element = pattern.elements.find((e) => e.id === elementId);
  if (!element) return 0;
  const left = readElement(element).items.filter((i) => i.kind === 'leave');
  return left.findIndex((i) => i.name === name) + 1;
}

function joinerOf(pattern, elementId, name) {
  const joiner = pattern.elements.map(readElement).find((element) => (
    element.items.some((i) => i.kind === 'join' && i.element === elementId && i.name === name)
  ));
  return joiner?.id ?? null;
}

function wordsFor(pattern, item) {
  if (item.kind === 'stitch') {
    if (item.source === 'estimated') {
      return item.error === undefined ? `大约编 ${item.count} 针（估算）` : `大约编 ${item.count} 针，上下差 ${item.error}（估算）`;
    }
    return item.source === 'inferred' ? `编 ${item.count} 针（推断）` : `编 ${item.count} 针`;
  }
  const note = item.source === 'source' ? '' : '（推测）';
  if (item.kind === 'deco') return `留一个装饰耳${note}`;
  if (item.kind === 'join') {
    const ordinal = picotOrdinal(pattern, item.element, item.name);
    return `接到 ${item.element} ${unitOf(pattern, item.element)}的${ordinal ? `第 ${ordinal} 个` : ''}接耳${note}`;
  }
  return null;
}

// Each part of an element, in the notation and in plain words.
export function partsInWords(pattern, element) {
  return readElement(element).items.map((item, index) => {
    let words = wordsFor(pattern, item);
    if (item.kind === 'leave') {
      const joiner = joinerOf(pattern, element.id, item.name);
      const note = item.source === 'source' ? '' : '（推测）';
      words = joiner ? `留一个接耳，等下 ${joiner} ${unitOf(pattern, joiner)}接到这里${note}` : `留一个接耳${note}`;
    }
    return {
      index,
      kind: item.kind,
      source: item.source,
      to: item.to,
      text: item.kind === 'stitch' ? numberText(item) : picotText(item),
      words,
      target: item.kind === 'join' ? item.element : null,
    };
  });
}

// A saved position is only trusted if it still fits the pattern.
export function clampProgress(saved, count) {
  const blank = { index: 0, part: null, finished: false };
  if (!saved || typeof saved !== 'object') return blank;
  if (!Number.isInteger(saved.index) || saved.index < 0 || saved.index >= count) return blank;
  return {
    index: saved.index,
    part: Number.isInteger(saved.part) && saved.part >= 0 ? saved.part : null,
    finished: saved.finished === true,
  };
}

// Parts that don't parse are left out here and reported by the structure check,
// so the other checks can still run on the rest.
function readSafely(raw) {
  const element = raw && typeof raw === 'object' ? raw : { id: String(raw) };
  const bad = [];
  const items = [];
  const parts = Array.isArray(element.parts) ? element.parts : [];
  parts.forEach((token) => {
    try {
      items.push(parseToken(token));
    } catch {
      bad.push(String(token));
    }
  });
  const stitches = items.filter((i) => i.kind === 'stitch').reduce((total, i) => total + i.count, 0);
  return {
    id: element.id, type: element.type, group: element.group, flip: element.flip, place: element.place, items, bad, stitches, missingParts: parts.length === 0,
  };
}

const isPoint = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

function placeIsValid(element) {
  const { place, type } = element;
  if (!place || typeof place !== 'object') return false;
  if (type === 'ring') {
    return isPoint(place.base) && isPoint(place.tip) && !samePoint(place.base, place.tip)
      && Number.isFinite(place.width) && place.width > 0 && ['cw', 'ccw'].includes(place.dir);
  }
  return isPoint(place.from) && isPoint(place.to) && !samePoint(place.from, place.to) && Number.isFinite(place.bulge);
}

function viewBoxIsValid(viewBox) {
  return Array.isArray(viewBox) && viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
}

function result(label, problems, okDetail) {
  const elements = [...new Set(problems.flatMap((p) => p.elements))];
  return {
    ok: problems.length === 0,
    label,
    detail: problems.length ? problems.map((p) => p.text).join('；') : okDetail,
    elements,
  };
}

function checkStructure(pattern, read) {
  const problems = [];
  const name = pattern.title || pattern.id || '这个花样';
  const fail = (text, elements = []) => problems.push({ text, elements });
  if (!Array.isArray(pattern.elements) || pattern.elements.length === 0) fail(`${name} 没有任何元素`);
  if (!viewBoxIsValid(pattern.layout?.viewBox)) fail(`${name} 的布局无效`);
  if (pattern.layout?.closed !== undefined && typeof pattern.layout.closed !== 'boolean') fail(`${name} 的布局无效`);
  if (!TIERS.includes(pattern.tier)) fail(`${name} 的信任等级无效：${pattern.tier}`);
  if (!RIGHTS.includes(pattern.rights?.kind)) fail(`${name} 的版权来源无效：${pattern.rights?.kind}`);
  const seen = new Set();
  read.forEach((element, index) => {
    if (typeof element.id !== 'string' || !/^[A-Za-z0-9]+$/.test(element.id)) {
      fail(`第 ${index + 1} 个元素的名字无效`);
      return;
    }
    if (seen.has(element.id)) fail(`${element.id} 重复了`, [element.id]);
    seen.add(element.id);
    if (element.flip !== undefined && (typeof element.flip?.value !== 'boolean' || !SOURCES.includes(element.flip?.source))) {
      fail(`${element.id} 的翻面写法无效`, [element.id]);
    }
    if (!TYPES.includes(element.type)) fail(`${element.id} 的类型无效：${element.type}`, [element.id]);
    if (element.missingParts) fail(`${element.id} 没有内容`, [element.id]);
    else if (element.stitches <= 0) fail(`${element.id} 没有针数`, [element.id]);
    if (TYPES.includes(element.type) && !placeIsValid(element)) fail(`${element.id} 的位置无效`, [element.id]);
    element.bad.forEach((token) => fail(`${element.id} 有看不懂的写法：${token}`, [element.id]));
  });
  return result('结构完整', problems, `${read.length} 个元素都读得懂`);
}

function checkStitches(read) {
  const problems = [];
  read.forEach((element) => {
    const counts = element.items.filter((i) => i.kind === 'stitch').map((i) => i.count);
    if (counts.length === 0) problems.push({ text: `${element.id} 没有针数`, elements: [element.id] });
    if (counts.some((c) => c <= 0)) problems.push({ text: `${element.id} 有针数不是正数`, elements: [element.id] });
  });
  return result('每段针数都是正数', problems, '都核对过');
}

// Every join must land on a picot left earlier, and every left picot must be used.
function checkJoins(read) {
  const left = new Map();
  const problems = [];
  read.forEach((element) => {
    const own = new Set();
    element.items.forEach((item) => {
      if (item.kind === 'leave') {
        if (own.has(item.name)) problems.push({ text: `${element.id} 有两个耳都叫 ${item.name}`, elements: [element.id] });
        own.add(item.name);
        left.set(`${element.id}.${item.name}`, { owner: element.id, multi: item.multi, uses: 0 });
      }
      if (item.kind === 'join') {
        const key = `${item.element}.${item.name}`;
        const picot = left.get(key);
        if (!picot) {
          problems.push({ text: `${element.id} 要接的 ${key} 还没留出来`, elements: [element.id] });
        } else {
          picot.uses += 1;
          if (picot.uses > 1 && !picot.multi) problems.push({ text: `${key} 被接了不止一次`, elements: [element.id, picot.owner] });
        }
      }
    });
  });
  left.forEach((picot, key) => {
    if (picot.uses === 0) problems.push({ text: `${key} 留了但没人接`, elements: [picot.owner] });
  });
  return result('每个接耳都接上了', problems, `一共 ${left.size} 处连接，没有多余也没有落空`);
}

function checkGroups(read) {
  const groups = new Map();
  read.filter((e) => e.group).forEach((element) => {
    if (!groups.has(element.group)) groups.set(element.group, []);
    groups.get(element.group).push(element);
  });
  const sum = (element) => element.items.filter((i) => i.kind === 'stitch').reduce((total, i) => total + i.count, 0);
  const decos = (element) => element.items.filter((i) => i.kind === 'deco').length;
  const picots = (element) => element.items.filter((i) => i.kind !== 'stitch').length;
  const problems = [];
  groups.forEach((members, group) => {
    [['针数', sum], ['装饰耳', decos], ['耳', picots]].forEach(([what, measure]) => {
      const values = new Set(members.map(measure));
      if (values.size > 1) {
        problems.push({
          text: `${group} 组的${what}不一致：${members.map((m) => `${m.id} ${measure(m)}`).join('，')}`,
          elements: members.map((m) => m.id),
        });
      }
    });
  });
  const summary = [...groups.values()].map((m) => `${m.length} 个元素 ${sum(m[0])} 针、${decos(m[0])} 个装饰耳`).join('；');
  return result('同组元素一致', problems, summary || '这个花样没有分组');
}

function checkTier(pattern, read) {
  const problems = [];
  const name = pattern.title || pattern.id || '这个花样';
  const { tier } = pattern;
  const marked = (source) => read.filter((e) => e.items.some((i) => i.source === source) || e.flip?.source === source);
  if (tier !== 'reconstruction') {
    marked('estimated').forEach((e) => problems.push({ text: `${e.id} 有估算数字，只有复原稿才可以`, elements: [e.id] }));
  }
  if (tier === 'checked' || tier === 'made') {
    const reviews = Array.isArray(pattern.reviewedBy) ? pattern.reviewedBy : [];
    if (!reviews.some((entry) => typeof entry === 'string' && entry.trim())) {
      problems.push({ text: `${name} 还没有独立复核记录`, elements: [] });
    }
  }
  if (tier === 'made') {
    if (pattern.toConfirm?.length) problems.push({ text: `${name} 还有待确认的内容`, elements: [] });
    marked('inferred').forEach((e) => problems.push({ text: `${e.id} 还有推断内容`, elements: [e.id] }));
  }
  if (tier === 'reconstruction') {
    read.forEach((element) => {
      if (element.items.some((i) => i.source === 'source')) {
        problems.push({ text: `${element.id} 有没标来源的内容`, elements: [element.id] });
      }
      if (element.items.some((i) => i.kind === 'stitch' && i.source === 'estimated' && i.error === undefined)) {
        problems.push({ text: `${element.id} 的估算针数没写误差`, elements: [element.id] });
      }
      if (element.flip?.source === 'source') {
        problems.push({ text: `${element.id} 的翻面不可能来自原图`, elements: [element.id] });
      }
    });
  }
  return result('信任等级和内容相符', problems, '没有发现矛盾');
}

// A bridge starts where the ring before it was based and ends at the next ring's base.
function checkBridgeEnds(pattern, read) {
  const problems = [];
  const close = (a, b) => isPoint(a) && isPoint(b) && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1;
  const count = read.length;
  read.forEach((element, index) => {
    if (element.type !== 'bridge' || !element.place) return;
    const wrap = pattern.layout?.closed === true;
    const before = index > 0 ? read[index - 1] : wrap ? read[count - 1] : null;
    const after = index < count - 1 ? read[index + 1] : wrap ? read[0] : null;
    if (before?.type === 'ring' && !close(element.place.from, before.place?.base)) {
      problems.push({ text: `${element.id} 的起点没接到 ${before.id} 环`, elements: [element.id] });
    }
    if (after?.type === 'ring' && !close(element.place.to, after.place?.base)) {
      problems.push({ text: `${element.id} 的终点没接到 ${after.id} 环`, elements: [element.id] });
    }
  });
  return result('桥两端接上了', problems, '都接到相邻的环');
}

function checkPublic(pattern) {
  const problems = [];
  const name = pattern.title || pattern.id || '这个花样';
  if (!['original', 'public-domain'].includes(pattern.rights?.kind)) {
    problems.push({ text: `${name} 不是原创或公版，不能放进公开目录`, elements: [] });
  }
  if (pattern.tier === 'reconstruction') problems.push({ text: `${name} 是复原稿，不能放进公开目录`, elements: [] });
  return result('可以公开', problems, '原创或公版内容');
}

// Empty when the pattern can be drawn. Pages show these instead of a chart.
export function structureProblems(pattern) {
  const structure = checkStructure(pattern, (Array.isArray(pattern.elements) ? pattern.elements : []).map(readSafely));
  return structure.ok ? [] : [structure.detail];
}

export function checkPattern(pattern, { public: isPublic = false } = {}) {
  const read = (Array.isArray(pattern.elements) ? pattern.elements : []).map(readSafely);
  const results = [
    checkStructure(pattern, read),
    checkStitches(read),
    checkJoins(read),
    checkGroups(read),
    checkBridgeEnds(pattern, read),
    checkTier(pattern, read),
  ];
  if (isPublic) results.push(checkPublic(pattern));
  return results;
}

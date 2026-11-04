// Reads a pattern file: turns part tokens into ordered steps, and checks the numbers agree.
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

export function buildSteps(pattern) {
  const elements = pattern.elements.map(readElement);
  const steps = [];
  elements.forEach((element, elementIndex) => {
    element.items.forEach((item, itemIndex) => {
      steps.push({ elementIndex, elementId: element.id, item, itemIndex, at: item.to, total: element.stitches });
    });
    if (element.type === 'ring') {
      steps.push({
        elementIndex,
        elementId: element.id,
        item: { kind: 'close' },
        itemIndex: element.items.length,
        at: element.stitches,
        total: element.stitches,
      });
    }
  });
  if (pattern.finish) {
    const last = elements[elements.length - 1];
    steps.push({
      elementIndex: elements.length - 1,
      elementId: last.id,
      item: { kind: 'finish', text: pattern.finish },
      itemIndex: last.items.length + 1,
      at: last.stitches,
      total: last.stitches,
    });
  }
  return steps;
}

// Which element joins to this left picot, if any.
export function findJoiner(pattern, elementId, name) {
  for (const element of pattern.elements.map(readElement)) {
    if (element.items.some((i) => i.kind === 'join' && i.element === elementId && i.name === name)) return element.id;
  }
  return null;
}

function unitOf(pattern, elementId) {
  return pattern.elements.find((e) => e.id === elementId)?.type === 'bridge' ? '桥' : '环';
}

export function describeStep(pattern, step) {
  const { item } = step;
  const unit = unitOf(pattern, step.elementId);
  if (item.kind === 'stitch') return { title: `编 ${item.count} 针`, detail: `这个${unit}编到第 ${step.at} 针，共 ${step.total} 针` };
  if (item.kind === 'deco') {
    const { items } = readElement(pattern.elements[step.elementIndex]);
    const decos = items.filter((i) => i.kind === 'deco');
    const nth = items.slice(0, step.itemIndex + 1).filter((i) => i.kind === 'deco').length;
    return { title: '留一个装饰耳', detail: `这个${unit}的第 ${nth} 个装饰耳，共 ${decos.length} 个` };
  }
  if (item.kind === 'leave') {
    const joiner = findJoiner(pattern, step.elementId, item.name);
    return { title: '留一个接耳', detail: joiner ? `等一下 ${joiner} ${unitOf(pattern, joiner)}会接到这里` : '后面要接到这里' };
  }
  if (item.kind === 'join') {
    const which = { first: '第一个耳', last: '最后一个耳' }[item.name] ?? `${item.name} 耳`;
    const target = `${item.element} ${unitOf(pattern, item.element)}`;
    return { title: `接到 ${target}`, detail: `接在 ${target}的${which}上` };
  }
  if (item.kind === 'close') return { title: `闭合 ${step.elementId} 环`, detail: `拉紧成环，这个环一共 ${step.total} 针` };
  return { title: '收尾', detail: item.text };
}

// Readable formula for one element, in the same marks as the hand-drawn charts.
export function elementFormula(element) {
  return readElement(element).items
    .map((i) => (i.kind === 'stitch' ? String(i.count) : i.kind === 'deco' ? '○' : '●'))
    .join(' ');
}

// One row per distinct formula, so identical elements read as one line of the stitch table.
export function formulaGroups(pattern) {
  const groups = new Map();
  pattern.elements.forEach((element) => {
    const formula = elementFormula(element);
    if (!groups.has(formula)) groups.set(formula, { formula, ids: [], stitches: readElement(element).stitches });
    groups.get(formula).ids.push(element.id);
  });
  return [...groups.values()];
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
  return { id: element.id, type: element.type, group: element.group, flip: element.flip, items, bad, missingParts: parts.length === 0 };
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
  if (typeof pattern.layout?.startAngle !== 'number') fail(`${name} 的布局无效`);
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
    checkTier(pattern, read),
  ];
  if (isPublic) results.push(checkPublic(pattern));
  return results;
}

import { checkPattern, structureProblems } from './pattern.js';
import { applyLayout, fitLayout } from './fit-layout.js';

// One small, valid pattern shown to the model as the exact shape to produce.
const EXAMPLE = {
  schema: 2,
  id: 'example',
  title: '双环小花边',
  craft: '梭编',
  difficulty: '入门',
  tier: 'sorted',
  rights: { kind: 'public-domain', note: '创始人决定非盈利公开' },
  summary: '两个环中间用一座桥相连，每环 12 针。',
  layout: { viewBox: [0, 0, 260, 200] },
  elements: [
    { id: 'A', type: 'ring', group: 'r', parts: ['4', 'p:side', '4', 'o', '4'], place: { base: [60, 120], tip: [60, 40], width: 50, dir: 'cw' } },
    { id: 'B', type: 'bridge', parts: ['6'], place: { from: [60, 120], to: [200, 120], bulge: 20 } },
    { id: 'C', type: 'ring', group: 'r', flip: { value: true, source: 'source' }, parts: ['4', 'j:A.side', '4', 'o', '4'], place: { base: [200, 120], tip: [200, 40], width: 50, dir: 'ccw' } },
  ],
  finish: '把线头打结，藏好线尾',
};

export function conversionPrompt(feedback = []) {
  const fixes = feedback.length
    ? `\n上一次的结果有这些问题，这次必须全部改正：\n${feedback.map((f) => `- ${f}`).join('\n')}\n`
    : '';
  return `你是梭编（tatting）图解的整理者。图片可能是书上的图解页、手绘图解，或梭编成品的照片。请把它转成一份可以直接照着编的图解，只输出一个 JSON 对象，不要任何解释、不要代码围栏。

目标是一份确定、能编的图解，不要含糊。图上标了的针数照抄；没标的，用对称性和梭编的逻辑补全，其余的自己决定，不要写问号、波浪号或任何不确定记号。

梭编基础：
- 环（ring）只用梭子。桥（bridge，也叫链）要梭子加线团。
- 环和桥各自画在图上它们所在的位置。
- 需要翻面（编的方向要反过来）的地方，在那个元素上写 "flip": {"value": true, "source": "source"}。
- 耳（picot）是针与针之间留出的小环。左边留下的接耳必须被之后恰好一个元素接上，除非列在 repeat.open 里。
- 桥从前一个环的 base 开始，到下一个环的 base 结束。
- 如果只是一张成品照片，没有图解：数一数环、桥、耳，再选合理的针数，做一个能编、比例匀称的花样。

格式：
- 顶层字段：schema 固定为 2；id 写 "converted"；title 用中文；craft 固定 "梭编"；difficulty（入门/进阶/高级之一）；summary 一两句中文；tier 固定 "sorted"；rights 固定 {"kind":"public-domain","note":"创始人决定非盈利公开"}；layout.viewBox 是 [x,y,w,h]；elements；finish（收尾的中文一句话）。页面上看得到出处时，加 "source" 写出书名和页码。
- elements 按编的顺序排列，id 用 A、B、C……。每个元素有 "type": "ring" 或 "bridge"，以及 "parts" 数组。
- parts 的记号："5" 表示 5 针；"o" 装饰耳；"p:名字" 留下一个接耳；"j:A.名字" 接到前面元素 A 的接耳。
- 环的 place：{"base":[x,y],"tip":[x,y],"width":数字,"dir":"cw"或"ccw"}。桥的 place：{"from":[x,y],"to":[x,y],"bulge":数字}，bulge 为正表示在行进方向的左边。
- 形状相同的元素写同一个 "group" 名。
- 花样是重复的，就加 "repeat": {"elements":["E","F"],"defaultTimes":5,"open":["F.tip"]}。
- 环的坐标要照图上的布局，并留够空间，环与环不要重叠。

例子（只示范格式）：
${JSON.stringify(EXAMPLE)}
${fixes}
只输出 JSON。`;
}

// Every reason a pattern can't be tatted, as plain strings. Empty means it's good.
export function validatePattern(pattern) {
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return ['结果不是一个花样'];
  const structure = structureProblems(pattern);
  if (structure.length) return structure;
  return checkPattern(pattern).filter((c) => !c.ok).map((c) => `${c.label}：${c.detail}`);
}

// A small closed motif from a sketch, shown as the exact shape to produce: six rings, six bridges.
export const DESIGN_EXAMPLE = {
  schema: 2,
  id: 'example',
  title: '六环小花片',
  craft: '梭编',
  difficulty: '入门',
  tier: 'sorted',
  rights: { kind: 'original', note: '手绘草图设计' },
  summary: '六个环朝里，六段桥围成一圈，左右对称。',
  threadNote: '1 个梭子 + 1 团线，不剪线。每次翻面后，环和桥之间只留极短的线。',
  layout: { viewBox: [0, 0, 100, 100], closed: true },
  elements: [
    { id: 'A', type: 'ring', parts: ['2', 'p:first', '4', 'o', '4', 'p:last', '2'], place: { base: [50, 25], tip: [50, 50], width: 20, dir: 'cw' } },
    { id: 'B', type: 'bridge', group: 'top', flip: { value: true, source: 'source' }, parts: ['12'], place: { from: [50, 25], to: [15, 35], bulge: -10 } },
    { id: 'C', type: 'ring', group: 'side', flip: { value: true, source: 'source' }, parts: ['8', 'j:A.last', '3', 'o', '3', 'p:last', '6'], place: { base: [15, 35], tip: [40, 40], width: 20, dir: 'cw' } },
    { id: 'D', type: 'bridge', group: 'mid', flip: { value: true, source: 'source' }, parts: ['8'], place: { from: [15, 35], to: [20, 60], bulge: -10 } },
    { id: 'E', type: 'ring', group: 'low', flip: { value: true, source: 'source' }, parts: ['5', 'j:C.last', '2', 'o', '2', 'p:last', '5'], place: { base: [20, 60], tip: [40, 55], width: 20, dir: 'cw' } },
    { id: 'F', type: 'bridge', group: 'tail', flip: { value: true, source: 'source' }, parts: ['8'], place: { from: [20, 60], to: [50, 85], bulge: -10 } },
    { id: 'G', type: 'ring', flip: { value: true, source: 'source' }, parts: ['5', 'j:E.last', '2', 'o', '2', 'p:last', '5'], place: { base: [50, 85], tip: [50, 65], width: 20, dir: 'cw' } },
    { id: 'H', type: 'bridge', group: 'tail', flip: { value: true, source: 'source' }, parts: ['8'], place: { from: [50, 85], to: [80, 60], bulge: -10 } },
    { id: 'I', type: 'ring', group: 'low', flip: { value: true, source: 'source' }, parts: ['5', 'j:G.last', '2', 'o', '2', 'p:last', '5'], place: { base: [80, 60], tip: [60, 55], width: 20, dir: 'cw' } },
    { id: 'J', type: 'bridge', group: 'mid', flip: { value: true, source: 'source' }, parts: ['8'], place: { from: [80, 60], to: [85, 35], bulge: -10 } },
    { id: 'K', type: 'ring', group: 'side', flip: { value: true, source: 'source' }, parts: ['6', 'j:I.last', '3', 'o', '3', 'j:A.first', '8'], place: { base: [85, 35], tip: [60, 40], width: 20, dir: 'cw' } },
    { id: 'L', type: 'bridge', group: 'top', flip: { value: true, source: 'source' }, parts: ['12'], place: { from: [85, 35], to: [50, 25], bulge: -10 } },
  ],
  finish: 'L 桥编完后翻面，把两股线拉到 A 环的底部，和起头的线尾打结，藏好线尾',
};

export function designPrompt(feedback = []) {
  const fixes = feedback.length
    ? `\n上一次的设计有这些问题，这次必须全部改正：\n${feedback.map((f) => `- ${f}`).join('\n')}\n`
    : '';
  return `你是有经验的梭编（tatting）设计师。图片是一张手绘草图，只画了想要的轮廓（比如爱心、蝴蝶、耳环）。请按草图设计一个新手到中级能编完的梭编花片，只输出一个 JSON 对象，不要任何解释、不要代码围栏。

这不是读图解：草图上没有针数，针数和结构都由你决定。摆位由程序计算，你只负责结构和针数。

设计步骤：
1. 先定竖直的对称轴。草图不完全对称时，按更清楚的一边来。成品必须左右严格对称。
2. 选用环和桥表现轮廓：轮廓的外缘用桥，桥两端各接一个朝里的环；凹进去的地方（如爱心顶部）和最尖的地方（如爱心底部）各放一个对称轴上的环。环总数 6 到 12 个，翅膀、圆弧这样的大块用大环和长桥。
3. 针数：环 10 到 24 针，桥 6 到 15 针，紧挨对称轴顶部那个环的两段桥不超过 13 针。每段桥都要够长，让相邻的环都放得下，又不能太长，否则接耳够不着。可以照这个比例起步：顶部环 12 针，紧挨它的两段桥 12 到 13 针，下一个环 20 针。轮廓越弯越宽的地方桥越长。
4. 针数由对称决定：左边每个元素和右边对应的元素针数完全相同、次序相反。
5. 相邻的环用接耳连起来，接耳只能接已经编好的耳：每个环靠近前一个环的地方接前一个环留的 "p:last"，靠近下一个环的地方留自己的 "p:last"；最后一个环接第一个环的 "p:first"。接耳的位置决定够不够得着：顶部环的两个接耳靠近它的底部，两边各离底部 2 针；其余环接上一个环的耳放在约 40% 针数处，留给下一个环的耳放在约 70% 针数处；底部环的两个接耳放在约 35% 和 65% 处。每个环可以加一个装饰耳在两个接耳中间。

结构规则（程序会检查）：
- elements 按编的顺序排列，id 用 A、B、C……。环和桥一环一桥交替，首尾相接成一圈，layout.closed 固定为 true。
- 第一个元素 A 是对称轴顶部的环，正中间的元素（第 m/2 个之后那个，m 是元素总数）是对称轴底部的环。
- 从 A 开始沿轮廓左边往下，到底部的环，再沿右边回到 A。除 A 以外的第 i 个元素和倒数第 i 个元素左右成对：类型相同，parts 的针数和耳次序完全相反（接耳的名字和接谁可以不同）。A 和底部的环自己要前后对称，例如 2, 耳, 4, 装饰耳, 4, 耳, 2。
- 除 A 外每个元素都写 "flip": {"value": true, "source": "source"}。
- 形状相同的元素写同一个 "group" 名。
- 每个留下的接耳必须被之后恰好一个元素接上。

格式：
- 顶层字段：schema 固定为 2；id 写 "converted"；title 用中文；craft 固定 "梭编"；difficulty（入门或进阶）；summary 一两句中文；threadNote 一句中文讲用线；tier 固定 "sorted"；rights 固定 {"kind":"original","note":"手绘草图设计"}；layout；elements；finish（收尾的中文一句话）。
- parts 的记号："5" 表示 5 针；"o" 装饰耳；"p:名字" 留下一个接耳；"j:A.名字" 接到前面元素 A 的接耳。不要写问号、波浪号或任何不确定记号。
- place 只是告诉程序大概的形状：把草图当作 100×100 的画面，环写 {"base":[x,y],"tip":[x,y],"width":20,"dir":"cw"}，base 是这个环的底部在轮廓上的位置，tip 是它朝向的地方；桥写 {"from":[x,y],"to":[x,y],"bulge":-10}。layout.viewBox 写 [0,0,100,100]。

例子（只示范格式）：
${JSON.stringify(DESIGN_EXAMPLE)}
${fixes}
只输出 JSON。`;
}

// The design's own place values are only a rough shape; the real geometry is computed here.
function placeDesign(pattern, aspect) {
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return { pattern: null, problems: ['结果不是一个花样'] };
  const fitted = fitLayout(pattern, { aspect });
  if (fitted.problems.length) return { pattern: null, problems: fitted.problems };
  const placed = applyLayout(pattern, fitted);
  return { pattern: placed, problems: validatePattern(placed) };
}

export async function designFromSketch(blob, sample, { aspect = 1, onProgress = () => {} } = {}) {
  const ask = async (feedback) => {
    const answer = await sample.json(designPrompt(feedback), { images: [blob], modelTier: 'complex' });
    const outcome = placeDesign(answer, aspect);
    if (outcome.pattern) outcome.pattern.id = `up-${Date.now().toString(36)}`;
    return outcome;
  };
  onProgress('正在按草图设计，请稍等……');
  let outcome = await ask([]);
  if (outcome.problems.length) {
    onProgress('有几处对不上，正在改……');
    outcome = await ask(outcome.problems);
  }
  return outcome;
}

export async function convertImage(blob, sample, { onProgress = () => {} } = {}) {
  const ask = (feedback) => sample.json(conversionPrompt(feedback), { images: [blob], modelTier: 'complex' });
  const finish = (pattern) => {
    if (pattern && typeof pattern === 'object') pattern.id = `up-${Date.now().toString(36)}`;
    return pattern;
  };
  onProgress('正在看图，请稍等……');
  let pattern = finish(await ask([]));
  let problems = validatePattern(pattern);
  if (problems.length) {
    onProgress('有几处对不上，正在改……');
    pattern = finish(await ask(problems));
    problems = validatePattern(pattern);
  }
  return { pattern, problems };
}

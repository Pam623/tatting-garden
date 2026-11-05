import { checkPattern, structureProblems } from './pattern.js';

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

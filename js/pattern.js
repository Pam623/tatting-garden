// Reads a pattern file: turns tokens into ordered steps, and checks the numbers add up.
//
// Tokens:  "5"         work 5 stitches
//          "o"         decorative picot
//          "p:first"   leave a join picot, named so another ring can join to it
//          "j:A.last"  join to picot "last" of ring A

export function parseToken(token) {
  if (/^\d+$/.test(token)) return { kind: 'stitch', count: Number(token) };
  if (token === 'o') return { kind: 'deco' };
  if (token.startsWith('p:')) return { kind: 'leave', name: token.slice(2) };
  const join = token.match(/^j:([^.]+)\.(.+)$/);
  if (join) return { kind: 'join', ring: join[1], name: join[2] };
  throw new Error(`Unknown token: ${token}`);
}

// Stitches and picots along a ring. Picots sit at the stitch count reached so far.
export function readRing(ring) {
  let at = 0;
  const items = ring.tokens.map((token) => {
    const item = { ...parseToken(token), from: at };
    if (item.kind === 'stitch') at += item.count;
    item.to = at;
    return item;
  });
  return { id: ring.id, items, stitches: at };
}

export function buildSteps(pattern) {
  const rings = pattern.rings.map(readRing);
  const steps = [];
  rings.forEach((ring, ringIndex) => {
    ring.items.forEach((item, itemIndex) => {
      steps.push({ ringIndex, ringId: ring.id, item, itemIndex, at: item.to, total: ring.stitches });
    });
    steps.push({
      ringIndex,
      ringId: ring.id,
      item: { kind: 'close' },
      itemIndex: ring.items.length,
      at: ring.stitches,
      total: ring.stitches,
    });
  });
  if (pattern.finish) {
    const last = rings[rings.length - 1];
    steps.push({
      ringIndex: rings.length - 1,
      ringId: last.id,
      item: { kind: 'finish', text: pattern.finish },
      itemIndex: last.items.length + 1,
      at: last.stitches,
      total: last.stitches,
    });
  }
  return steps;
}

// Which ring joins to this left picot, if any.
export function findJoiner(pattern, ringId, name) {
  for (const ring of pattern.rings.map(readRing)) {
    if (ring.items.some((i) => i.kind === 'join' && i.ring === ringId && i.name === name)) return ring.id;
  }
  return null;
}

export function describeStep(pattern, step) {
  const { item } = step;
  if (item.kind === 'stitch') return { title: `编 ${item.count} 针`, detail: `这个环编到第 ${step.at} 针，共 ${step.total} 针` };
  if (item.kind === 'deco') {
    const ring = readRing(pattern.rings[step.ringIndex]);
    const decos = ring.items.filter((i) => i.kind === 'deco');
    const nth = ring.items.slice(0, step.itemIndex + 1).filter((i) => i.kind === 'deco').length;
    return { title: '留一个装饰耳', detail: `这个环的第 ${nth} 个装饰耳，共 ${decos.length} 个` };
  }
  if (item.kind === 'leave') {
    const joiner = findJoiner(pattern, step.ringId, item.name);
    return { title: '留一个接耳', detail: joiner ? `等一下 ${joiner} 环会接到这里` : '后面要接到这里' };
  }
  if (item.kind === 'join') {
    const which = item.name === 'first' ? '第一个耳' : '最后一个耳';
    return { title: `接到 ${item.ring} 环`, detail: `接在 ${item.ring} 环的${which}上` };
  }
  if (item.kind === 'close') return { title: `闭合 ${step.ringId} 环`, detail: `拉紧成环，这个环一共 ${step.total} 针` };
  return { title: '收尾', detail: item.text };
}

// Readable formula for one ring, in the same marks as the hand-drawn charts.
export function ringFormula(ring) {
  return readRing(ring).items
    .map((i) => (i.kind === 'stitch' ? String(i.count) : i.kind === 'deco' ? '○' : '●'))
    .join(' ');
}

export function checkPattern(pattern) {
  const rings = pattern.rings.map(readRing);
  const results = [];
  const add = (ok, label, detail) => results.push({ ok, label, detail });

  const expected = pattern.expect?.stitchesPerRing;
  if (expected !== undefined) {
    const off = rings.filter((r) => r.stitches !== expected);
    add(off.length === 0, `每个环都是 ${expected} 针`,
      off.length ? `不对：${off.map((r) => `${r.id} 环 ${r.stitches} 针`).join('，')}` : `${rings.length} 个环都核对过`);
  }

  const expectedDeco = pattern.expect?.decoPerRing;
  if (expectedDeco !== undefined) {
    const count = (r) => r.items.filter((i) => i.kind === 'deco').length;
    const off = rings.filter((r) => count(r) !== expectedDeco);
    add(off.length === 0, `每个环都有 ${expectedDeco} 个装饰耳`,
      off.length ? `不对：${off.map((r) => `${r.id} 环 ${count(r)} 个`).join('，')}` : `一共 ${expectedDeco * rings.length} 个`);
  }

  // Every join must land on a picot that was left earlier, and every left picot must get used once.
  const left = new Map();
  const problems = [];
  rings.forEach((ring) => {
    ring.items.forEach((item) => {
      if (item.kind === 'join') {
        const key = `${item.ring}.${item.name}`;
        if (!left.has(key)) problems.push(`${ring.id} 环要接的 ${key} 还没留出来`);
        else if (left.get(key) > 0) problems.push(`${key} 被接了两次`);
        else left.set(key, 1);
      }
      if (item.kind === 'leave') left.set(`${ring.id}.${item.name}`, 0);
    });
  });
  left.forEach((used, key) => { if (!used) problems.push(`${key} 留了但没人接`); });
  add(problems.length === 0, '每个接耳都接上了', problems.length ? problems.join('；') : `一共 ${left.size} 处连接，没有多余也没有落空`);

  return results;
}

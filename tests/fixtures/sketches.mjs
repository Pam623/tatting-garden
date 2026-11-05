// The four test sketches, in a 600 by 600 square.
const curve = (p, a, b, c, steps = 24) => Array.from({ length: steps }, (_, i) => {
  const t = (i + 1) / steps;
  const u = 1 - t;
  return [u * u * u * p[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0], u * u * u * p[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1]];
});
const chain = (start, ...parts) => {
  const line = [start];
  parts.forEach(([a, b, c]) => line.push(...curve(line[line.length - 1], a, b, c)));
  return line;
};
const reflect = (line) => line.map(([x, y]) => [600 - x, y]);
const ring = (cx, cy, r) => Array.from({ length: 41 }, (_, k) => [cx + r * Math.cos((k / 40) * 2 * Math.PI), cy + r * Math.sin((k / 40) * 2 * Math.PI)]);

export const SKETCHES = {
  heart: [chain([300, 520], [[150, 400], [70, 320], [85, 220]], [[100, 120], [235, 100], [305, 205]], [[370, 95], [505, 120], [518, 225]], [[530, 320], [450, 400], [297, 522]])],
  star: [[[300, 70], [365, 235], [540, 245], [405, 355], [452, 525], [300, 430], [150, 528], [196, 356], [60, 245], [236, 236], [300, 70]]],
  teardrop: [[[300, 80], [300, 110]], ring(300, 125, 14), chain([300, 150], [[230, 270], [170, 340], [190, 430]], [[210, 520], [390, 520], [410, 430]], [[430, 340], [370, 270], [302, 150]])],
  butterfly: (() => {
    const wing = chain([295, 300], [[200, 120], [70, 110], [85, 240]], [[95, 330], [200, 330], [295, 305]], [[220, 340], [130, 400], [160, 490]], [[190, 540], [270, 470], [298, 340]]);
    return [wing, reflect(wing), [[298, 220], [300, 420]], chain([298, 220], [[280, 170], [260, 150], [240, 140]]), reflect(chain([298, 220], [[280, 170], [260, 150], [240, 140]]))];
  })(),
};


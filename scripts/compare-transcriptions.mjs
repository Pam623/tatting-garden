// Compares two readings of a chart:  node scripts/compare-transcriptions.mjs <a.json> <b.json>
// Exits 0 when the numbers match, 1 when they differ, 2 when a file can't be read.
import { readFileSync } from 'node:fs';
import { compareTranscriptions } from '../js/compare.js';

const [firstPath, secondPath] = process.argv.slice(2);
if (!firstPath || !secondPath) {
  console.error('需要两个文件：compare-transcriptions.mjs <a.json> <b.json>');
  process.exit(2);
}

let report;
try {
  const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
  report = compareTranscriptions(load(firstPath), load(secondPath));
} catch (error) {
  console.error(`读不了这两份文件：${error.message}`);
  process.exit(2);
}

console.log(`比较了 ${report.compared} 个元素，发现 ${report.differences.length} 处不同。`);
report.differences.forEach((difference) => console.log(`- ${difference.text}`));
if (report.notes.length) {
  console.log('\n数字一致但把握程度不同：');
  report.notes.forEach((note) => console.log(`- ${note}`));
}
process.exit(report.match ? 0 : 1);

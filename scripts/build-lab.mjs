// Bundles the private lab into one page:  node scripts/build-lab.mjs
// Writes lab/dist/index.html, with every lab pattern, the styles and the page code inlined.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lab = process.argv[2] ?? join(root, 'lab');
const read = (path) => readFileSync(join(root, path), 'utf8');
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const patterns = readdirSync(lab)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const pattern = JSON.parse(readFileSync(join(lab, name), 'utf8'));
    if (pattern.photo) {
      if (!existsSync(join(lab, pattern.photo))) throw new Error(`${name} names a photo that isn't in the lab: ${pattern.photo}`);
      const type = IMAGE_TYPES[extname(pattern.photo).toLowerCase()];
      if (!type) throw new Error(`Unsupported photo type: ${pattern.photo}`);
      pattern.photo = `data:${type};base64,${readFileSync(join(lab, pattern.photo)).toString('base64')}`;
    }
    return pattern;
  });

// The three modules become one script, so the page works as a single file.
const code = ['js/pattern.js', 'js/diagram.js', 'js/app.js']
  .map(read)
  .join('\n')
  .replace(/^import [\s\S]*?;$/gm, '')
  .replace(/^export /gm, '');

const safe = JSON.stringify(patterns).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>梭编实验室</title>
<style>${read('style.css')}</style>
</head>
<body>
<main id="app" class="page"></main>
<script>window.TATTING_PATTERNS = ${safe};</script>
<script>${code.replace(/<\/script/g, '<\\/script')}</script>
</body>
</html>
`;

mkdirSync(join(lab, 'dist'), { recursive: true });
writeFileSync(join(lab, 'dist', 'index.html'), html);
console.log(`Bundled ${patterns.length} patterns into ${join(lab, 'dist', 'index.html')}`);

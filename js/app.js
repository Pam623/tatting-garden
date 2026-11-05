import { showHome } from './home.js';
import { showPattern } from './pattern-page.js';
import { app, embedded, loadPattern, runCleanup } from './shared.js';
import { rereadSaved, showUpload, startStudio, studioNoticeHtml } from './studio.js';
import { showWork } from './work.js';

const studioReady = startStudio();

let routeCount = 0;

async function route() {
  routeCount += 1;
  const thisRoute = routeCount;
  runCleanup();
  window.scrollTo(0, 0);
  await studioReady;
  if (thisRoute !== routeCount) return;
  const match = location.hash.match(/^#\/p\/([\w-]+)(\/work)?$/);
  document.body.classList.toggle('in-work', Boolean(match?.[2]));
  try {
    // Fetch first, so a page that finishes loading late can't draw over a newer one.
    // A home page failure is sorted out per pattern inside showHome.
    if (match) await loadPattern(match[1]);
    if (thisRoute !== routeCount) return;
    if (location.hash === '#/upload') await showUpload();
    else if (match?.[2]) await showWork(match[1]);
    else if (match) await showPattern(match[1]);
    else await showHome(() => thisRoute === routeCount);
  } catch (error) {
    console.error(error);
    if (thisRoute !== routeCount) return;
    app.innerHTML = '<p class="error">这一页没打开，<a href="#/">回到全部花样</a>。</p>' + studioNoticeHtml();
  }
}

if (embedded) {
  app.addEventListener('click', async (event) => {
    if (event.target.id !== 'reread') return;
    event.target.disabled = true;
    event.target.textContent = '正在读取……';
    await rereadSaved();
    route();
  });
}

window.addEventListener('hashchange', route);
route();

// Runs after `vite build` (see package.json "build"). Renders every public
// route into dist/<route>/index.html so nginx serves real HTML to crawlers
// and people alike; React then takes over in the browser as before.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const serverEntry = path.join(root, 'dist-ssr', 'entry-server.js');

const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const { render, ROUTES } = await import(pathToFileURL(serverEntry).href);

// The SPA shell's default <title> would duplicate the page's own title.
const shell = template.replace(/<title>[\s\S]*?<\/title>\s*/, '');
// Keep a copy of the untouched shell for the backend blog renderer and the
// SPA fallback (dist/index.html itself becomes the home page).
fs.writeFileSync(path.join(dist, 'spa.html'), template);

let failed = 0;
for (const route of ROUTES) {
  try {
    const { html, head } = render(route);
    if (!head.includes('<title')) throw new Error('no <title> rendered');
    const page = shell
      .replace('</head>', `${head}\n</head>`)
      .replace('<div id="root"></div>', `<div id="root">${html}</div>`);
    const out = route === '/' ? path.join(dist, 'index.html') : path.join(dist, route.slice(1), 'index.html');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, page);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`prerendered ${route.padEnd(48)} ${String(text.length).padStart(6)} chars of text`);
  } catch (err) {
    failed += 1;
    console.error(`prerender FAILED for ${route}:`, err.message);
  }
}
fs.rmSync(path.join(root, 'dist-ssr'), { recursive: true, force: true });
if (failed) process.exit(1);

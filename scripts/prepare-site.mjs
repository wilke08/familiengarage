import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const files = ['index.html', 'app.js', 'auth.js', 'config.js', 'supabaseClient.js', 'style.css'];
const revision = process.env.GITHUB_SHA || 'local';
await mkdir('_site', { recursive: true });
for (const file of files) await copyFile(file, `_site/${file}`);
const html = await readFile('index.html', 'utf8');
const versionedHtml = html.replace(/((?:src|href)="\.\/)([^"?]+\.(?:js|css))"/g, (match, prefix, file) =>
  files.includes(file) ? `${prefix}${file}?v=${encodeURIComponent(revision)}"` : match,
);
await writeFile('_site/index.html', versionedHtml);

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const fail = (file, message) => failures.push(`${relative(root, file)}: ${message}`);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (name === '.git') return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const htmlFiles = walk(root).filter((file) => file.endsWith('.html'));
const canonicalUrls = new Set();

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const isErrorPage = file.endsWith('/404.html');
  const count = (pattern) => html.match(pattern)?.length ?? 0;

  if (!/^<!doctype html>/i.test(html)) fail(file, 'missing HTML doctype');
  if (!/<html\s+lang="en">/i.test(html)) fail(file, 'missing English language declaration');
  if (count(/<main\b/g) !== 1) fail(file, 'must contain exactly one main element');
  if (count(/<h1\b/g) !== 1) fail(file, 'must contain exactly one h1');
  if (!/<title>[^<]+<\/title>/.test(html)) fail(file, 'missing non-empty title');
  if (!/<meta name="viewport"/.test(html)) fail(file, 'missing viewport metadata');

  if (!isErrorPage) {
    for (const field of ['description', 'twitter:card', 'twitter:image']) {
      if (!new RegExp(`<meta name="${field}"`).test(html)) fail(file, `missing ${field} metadata`);
    }
    for (const field of ['og:title', 'og:description', 'og:type', 'og:url', 'og:image', 'og:image:alt']) {
      if (!new RegExp(`<meta property="${field}"`).test(html)) fail(file, `missing ${field} metadata`);
    }
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    if (!canonical) fail(file, 'missing canonical URL');
    else if (canonicalUrls.has(canonical)) fail(file, `duplicate canonical URL ${canonical}`);
    else canonicalUrls.add(canonical);
  } else if (!/<meta name="robots" content="noindex">/.test(html)) {
    fail(file, '404 page must be noindex');
  }

  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|#)/.test(reference)) continue;
    const clean = reference.split(/[?#]/, 1)[0];
    const target = clean.startsWith('/') ? join(root, clean) : resolve(dirname(file), clean);
    const expected = clean.endsWith('/') ? join(target, 'index.html') : target;
    if (!existsSync(expected)) fail(file, `broken internal reference ${reference}`);
  }

  for (const match of html.matchAll(/<script type="(?:application\/ld\+json|speculationrules)">([^<]+)<\/script>/g)) {
    try { JSON.parse(match[1]); } catch { fail(file, 'contains invalid declarative JSON'); }
  }
}

const png = readFileSync(join(root, 'assets/social-card.png'));
if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
  fail(join(root, 'assets/social-card.png'), 'social card must be 1200 by 630 pixels');
}

const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
for (const canonical of canonicalUrls) {
  if (!sitemap.includes(`<loc>${canonical}</loc>`)) fail(join(root, 'sitemap.xml'), `missing ${canonical}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Checked ${htmlFiles.length} HTML files, ${canonicalUrls.size} canonical URLs, internal references, declarative JSON, and social-card dimensions.`);

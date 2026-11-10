// Downloads the small (minified) builds of three.js into vendor/, for the version named here.
// Run from the project folder: node tools/fetch-three.mjs
import { writeFileSync } from 'node:fs';

const VERSION = '0.187.0';
// The small module imports './three.core.js', so both keep the plain names.
for (const [from, to] of [['three.module.min.js', 'three.module.js'], ['three.core.min.js', 'three.core.js']]) {
  const res = await fetch(`https://cdn.jsdelivr.net/npm/three@${VERSION}/build/${from}`);
  if (!res.ok) throw new Error(`${from}: ${res.status}`);
  const text = await res.text();
  writeFileSync(new URL(`../vendor/${to}`, import.meta.url), text);
  console.log(to, text.length, 'bytes');
}

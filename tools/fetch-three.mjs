// Downloads the small (minified) builds of three.js into vendor/, for the version named here.
// Run from the project folder: node tools/fetch-three.mjs
// Both files are downloaded before either is written, so a failed download leaves the old pair
// in place rather than a new module next to an old core.
import { writeFileSync } from 'node:fs';

const VERSION = '0.187.0';
// The small module imports './three.core.js', so both keep the plain names.
const FILES = [['three.module.min.js', 'three.module.js'], ['three.core.min.js', 'three.core.js']];
const got = [];
for (const [from, to] of FILES) {
  const res = await fetch(`https://cdn.jsdelivr.net/npm/three@${VERSION}/build/${from}`);
  if (!res.ok) throw new Error(`${from}: ${res.status}; vendor/ is unchanged`);
  const text = await res.text();
  if (!text.length) throw new Error(`${from}: empty; vendor/ is unchanged`);
  got.push([to, text]);
}
for (const [to, text] of got) {
  writeFileSync(new URL(`../vendor/${to}`, import.meta.url), text);
  console.log(to, text.length, 'bytes');
}

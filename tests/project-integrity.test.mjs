import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = resolve(ROOT, 'site');
const JS_DIR = resolve(SITE, 'js');

function firstPartyModules() {
  return readdirSync(JS_DIR)
    .filter(file => extname(file) === '.js')
    .map(file => resolve(JS_DIR, file))
    .sort();
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function readGlb(file) {
  const bytes = readFileSync(file);
  const chunks = new Map();
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    chunks.set(type, bytes.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  const jsonChunk = chunks.get(0x4e4f534a);
  assert.ok(jsonChunk, `${relative(ROOT, file)} has no JSON chunk`);
  return {
    json: JSON.parse(jsonChunk.toString('utf8')),
    binary: chunks.get(0x004e4942),
  };
}

function jpegDimensions(bytes) {
  if (bytes.readUInt16BE(0) !== 0xffd8) return null;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (startOfFrame.has(marker) && offset + 7 < bytes.length) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    if (length < 2) break;
    offset += length;
  }
  return null;
}

function imageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png') {
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', 'invalid PNG signature');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes);
  return null;
}

function embeddedImageDimensions(file) {
  const { json, binary } = readGlb(file);
  return (json.images || []).map((image, index) => {
    assert.ok(Number.isInteger(image.bufferView), `${basename(file)} image ${index} must be embedded`);
    assert.ok(binary, `${basename(file)} has embedded images but no binary chunk`);
    const view = json.bufferViews[image.bufferView];
    const start = view.byteOffset || 0;
    const data = binary.subarray(start, start + view.byteLength);
    const dimensions = imageDimensions(data, image.mimeType);
    assert.ok(dimensions, `${basename(file)} image ${index} uses unsupported ${image.mimeType}`);
    return dimensions;
  });
}

test('all first-party JavaScript modules pass Node syntax checking', async t => {
  for (const file of firstPartyModules()) {
    await t.test(file.slice(ROOT.length + 1), () => {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    });
  }
});

test('all static module imports resolve to vendored or local files', () => {
  const missing = [];
  const unsupported = [];
  const importPattern = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

  for (const file of firstPartyModules()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      let target;
      if (specifier === 'three') target = resolve(SITE, 'vendor/three.module.js');
      else if (specifier.startsWith('three/addons/')) {
        target = resolve(SITE, 'vendor/addons', specifier.slice('three/addons/'.length));
      } else if (specifier.startsWith('.')) target = resolve(dirname(file), specifier);
      else unsupported.push(`${file.slice(ROOT.length + 1)} -> ${specifier}`);

      if (target && !existsSync(target)) {
        missing.push(`${file.slice(ROOT.length + 1)} -> ${target.slice(ROOT.length + 1)}`);
      }
    }
  }

  assert.deepEqual(unsupported, [], `Unexpected bare imports:\n${unsupported.join('\n')}`);
  assert.deepEqual(missing, [], `Missing module files:\n${missing.join('\n')}`);
});

test('the HTML import map and module entry point target existing files', () => {
  const html = readFileSync(resolve(SITE, 'index.html'), 'utf8');
  const importMapMatch = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(importMapMatch, 'site/index.html must define an import map');
  const importMap = JSON.parse(importMapMatch[1]);
  assert.equal(importMap.imports.three, './vendor/three.module.js');
  assert.equal(importMap.imports['three/addons/'], './vendor/addons/');
  assert.ok(existsSync(resolve(SITE, importMap.imports.three)));
  assert.ok(existsSync(resolve(SITE, importMap.imports['three/addons/'])));

  const entryMatch = html.match(/<script\s+type="module"\s+src="([^"]+)"/);
  assert.ok(entryMatch, 'site/index.html must load a module entry point');
  assert.ok(existsSync(resolve(SITE, entryMatch[1])));
});

test('boat index entries are unique and point to existing GLB files', () => {
  const indexPath = resolve(SITE, 'assets/boats/index.json');
  const entries = JSON.parse(readFileSync(indexPath, 'utf8'));
  const names = entries.map(entry => entry.name);

  assert.ok(entries.length > 0, 'boat index must not be empty');
  assert.equal(new Set(names).size, names.length, 'boat names must be unique');
  for (const entry of entries) {
    assert.equal(entry.type, 'file');
    assert.match(entry.name, /^[a-z0-9_.-]+\.glb$/i);
    assert.ok(existsSync(resolve(SITE, 'assets/boats', entry.name)), `${entry.name} is missing`);
  }
});

test('literal first-party asset paths point to existing files', () => {
  const missing = [];
  const assetPattern = /['"](\.\/assets\/[^'"?#]+)['"]/g;
  const sources = [resolve(SITE, 'index.html'), ...firstPartyModules()];

  for (const file of sources) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(assetPattern)) {
      const asset = resolve(SITE, match[1]);
      if (!existsSync(asset)) missing.push(`${file.slice(ROOT.length + 1)} -> ${match[1]}`);
    }
  }

  assert.deepEqual(missing, [], `Missing static assets:\n${missing.join('\n')}`);
});

test('every bundled runtime asset is reachable from the application', () => {
  const modules = firstPartyModules();
  const sources = [resolve(SITE, 'index.html'), ...modules]
    .map(file => readFileSync(file, 'utf8'))
    .join('\n');
  const boatEntries = JSON.parse(readFileSync(resolve(SITE, 'assets/boats/index.json'), 'utf8'));
  const indexedBoats = new Set(boatEntries.map(entry => entry.name));
  const runtimeExtensions = new Set(['.glb', '.hdr', '.mp3', '.wav']);
  const orphaned = [];

  for (const file of filesUnder(resolve(SITE, 'assets'))) {
    if (!runtimeExtensions.has(extname(file))) continue;
    const sitePath = relative(SITE, file).split('\\').join('/');
    const fileName = basename(file);
    const referenced = sources.includes(`./${sitePath}`) || sources.includes(fileName)
      || (sitePath.startsWith('assets/boats/') && indexedBoats.has(fileName))
      || (sitePath.startsWith('assets/boats-mobile/') && indexedBoats.has(fileName));
    if (!referenced) orphaned.push(sitePath);
  }

  assert.deepEqual(orphaned, [], `Unreferenced runtime assets:\n${orphaned.join('\n')}`);
});

test('every GLB is structurally valid, inventoried and redistributable', () => {
  const notices = readFileSync(resolve(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const invalid = [];
  const missingNotices = [];
  const forbiddenLicenses = [];

  for (const file of filesUnder(resolve(SITE, 'assets')).filter(path => extname(path) === '.glb')) {
    const bytes = readFileSync(file);
    const projectPath = relative(ROOT, file).split('\\').join('/');
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF'
      || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length
      || bytes.readUInt32LE(16) !== 0x4e4f534a) {
      invalid.push(projectPath);
      continue;
    }

    if (!notices.includes(projectPath)) missingNotices.push(projectPath);
    const jsonLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
    const license = gltf.asset?.extras?.license ?? '';
    if (/SKETCHFAB|EDITORIAL|(?:^|-)ND(?:-|$)/i.test(license)) {
      forbiddenLicenses.push(`${projectPath}: ${license}`);
    }
  }

  assert.deepEqual(invalid, [], `Invalid GLB containers:\n${invalid.join('\n')}`);
  assert.deepEqual(missingNotices, [], `GLBs missing from THIRD_PARTY_NOTICES.md:\n${missingNotices.join('\n')}`);
  assert.deepEqual(forbiddenLicenses, [], `Non-redistributable GLB licenses:\n${forbiddenLicenses.join('\n')}`);
});

test('boats with oversized embedded textures have safe mobile variants', () => {
  const boats = resolve(SITE, 'assets/boats');
  const mobileBoats = resolve(SITE, 'assets/boats-mobile');
  const unsafe = [];

  for (const name of readdirSync(boats).filter(file => extname(file) === '.glb')) {
    const desktopDimensions = embeddedImageDimensions(resolve(boats, name));
    if (!desktopDimensions.some(({ width, height }) => Math.max(width, height) > 1024)) continue;
    const mobilePath = resolve(mobileBoats, name);
    if (!existsSync(mobilePath)) {
      unsafe.push(`${name}: missing mobile variant`);
      continue;
    }
    const mobileDimensions = embeddedImageDimensions(mobilePath);
    if (mobileDimensions.length !== desktopDimensions.length) {
      unsafe.push(`${name}: mobile variant changed the embedded image count`);
    }
    mobileDimensions.forEach(({ width, height }, index) => {
      if (Math.max(width, height) > 1024) {
        unsafe.push(`${name}: mobile image ${index} is ${width}x${height}`);
      }
    });
  }

  assert.deepEqual(unsafe, [], `Unsafe mobile boat assets:\n${unsafe.join('\n')}`);
});

test('optional fauna and seabed models use the constrained-device decode queue', () => {
  const deferredModules = [
    'birds.js', 'dolphins.js', 'fish.js', 'manta.js',
    'seabed.js', 'turtles.js', 'whale.js', 'wildlife.js',
  ];
  const violations = [];

  for (const name of deferredModules) {
    const source = readFileSync(resolve(JS_DIR, name), 'utf8');
    if (!source.includes("from './deferred-loader.js'")) {
      violations.push(`${name}: deferred loader import missing`);
    }
    if (!source.includes('loadGLTFDeferred(')) {
      violations.push(`${name}: no deferred model load`);
    }
    if (/\bnew\s+GLTFLoader\b|\.loadAsync\s*\(/.test(source)) {
      violations.push(`${name}: bypasses the constrained-device decode queue`);
    }
  }

  assert.deepEqual(violations, [], violations.join('\n'));
});

test('fauna frame loops reuse species metadata without filter allocations', () => {
  for (const name of ['birds.js', 'fish.js']) {
    const source = readFileSync(resolve(JS_DIR, name), 'utf8');
    assert.equal(
      source.match(/Object\.keys\(SPECIES\)/g)?.length,
      1,
      `${name} should create its species key list only once`,
    );
    assert.doesNotMatch(
      source,
      /\.filter\([^\n]*\.key\s*===\s*key/,
      `${name} should count active species without allocating a filtered array`,
    );
  }
});

test('fauna frame loops avoid temporary threat objects and square-root distance checks', () => {
  for (const name of [
    'birds.js', 'dolphins.js', 'fish.js', 'manta.js',
    'turtles.js', 'whale.js', 'wildlife.js',
  ]) {
    const source = readFileSync(resolve(JS_DIR, name), 'utf8');
    assert.doesNotMatch(source, /_v\.length\(\)|\.distanceTo\(/, name);
  }

  for (const name of ['fish.js', 'manta.js', 'turtles.js']) {
    const source = readFileSync(resolve(JS_DIR, name), 'utf8');
    assert.doesNotMatch(source, /return \{ ax:/, `${name} allocates a threat result`);
    assert.match(source, /sampleBoatThreat\(/, `${name} must use the shared threat sampler`);
  }
});

test('main delegates fauna construction, budgets and frame updates to one manager', () => {
  const source = readFileSync(resolve(JS_DIR, 'main.js'), 'utf8');
  assert.match(source, /createFaunaManager\(/);
  assert.match(source, /fauna\.setPerformanceBudget\(quality\)/);
  assert.match(source, /fauna\.update\(dt\)/);
  assert.doesNotMatch(source, /new (Wildlife|FishLife|Dolphins|Whales|Seabed|Turtles|Mantas|Birds)\(/);
});

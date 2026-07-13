import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nginx = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

test('both container entry points install the production nginx configuration', () => {
  assert.match(dockerfile, /COPY nginx\.conf \/etc\/nginx\/nginx\.conf/);
  assert.match(compose, /\.\/nginx\.conf:\/etc\/nginx\/nginx\.conf:ro/);
});

test('nginx compresses source, GLB and HDR payloads while preserving validators', () => {
  assert.match(nginx, /gzip on;/);
  assert.match(nginx, /gzip_vary on;/);
  assert.match(nginx, /application\/javascript/);
  assert.match(nginx, /model\/gltf-binary glb;/);
  assert.match(nginx, /image\/vnd\.radiance hdr;/);
  assert.match(nginx, /etag on;/);
  assert.match(nginx, /Cache-Control "public, no-cache" always;/);
  assert.doesNotMatch(nginx, /immutable|max-age=[1-9]/);
});

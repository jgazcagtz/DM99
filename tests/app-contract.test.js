import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFile(join(root, path), 'utf8');

test('browser shell exposes one accessible control for every core v3 workflow', async () => {
  const html = await read('index.html');
  const requiredIds = [
    'enable-audio', 'sequencer-grid', 'play', 'stop', 'pattern-slots',
    'step-velocity', 'step-probability', 'step-ratchet', 'step-nudge',
    'generate-variations', 'evolve-variation', 'lock-current-track',
    'mixer-dialog', 'project-name', 'save-project', 'export-json',
    'export-midi', 'export-wav', 'share-pattern', 'sample-import',
    'record-sample', 'enable-midi', 'guide-dialog', 'project-revision-select',
    'restore-revision', 'sample-library-select', 'load-library-sample',
    'delete-library-sample', 'master-eq-low', 'master-eq-mid', 'master-eq-high',
  ];

  for (const id of requiredIds) {
    assert.equal((html.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length, 1, `${id} must be unique`);
  }
  assert.match(html, /<script\s+type="module"\s+src="script\.js"><\/script>/u);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)="https?:\/\//iu);
  assert.match(html, /<dialog id="guide-dialog"/u);
  assert.match(html, /aria-live="polite"/u);
});

test('browser integration stays local-first and restores every persisted generator control', async () => {
  const script = await read('script.js');
  assert.doesNotMatch(script, /fetch\s*\(\s*['"]\/api\/generate-pattern/iu);
  assert.doesNotMatch(script, /(?:Magenta|MusicRNN|HfInference|Tone\.)/u);
  assert.match(script, /variationCandidates\s*=\s*\[0, 1, 2\]/u);
  assert.match(script, /renderPatternOffline/u);
  assert.match(script, /random:\s*createSeededRandom\(`\$\{project\.generator\.seed\}:\$\{project\.activePattern\}:playback`\)/u);
  assert.match(script, /restoreToken === sampleRestoreToken/u);
  assert.match(script, /openProjectStore/u);
  assert.match(script, /openSamplerStore/u);
  for (const setting of ['energy', 'complexity', 'syncopation', 'humanize']) {
    assert.match(script, new RegExp(`\\$\\('${setting}-slider'\\)\\.value = String\\(project\\.generator\\.${setting}\\)`, 'u'));
  }
});

test('PWA shell caches every browser module and keeps releases atomic while offline', async () => {
  const worker = await read('service-worker.js');
  const shellFiles = [
    '/index.html', '/styles.css', '/script.js', '/manifest.webmanifest',
    '/src/instruments.js', '/src/audio-engine.js', '/src/audio-dsp.js',
    '/src/project-state.js', '/src/pattern-engine.js', '/src/pattern-constants.js',
    '/src/project-store.js', '/src/sampler-store.js', '/src/exporters.js',
    '/src/binary-utils.js',
  ];
  for (const file of shellFiles) assert.match(worker, new RegExp(file.replaceAll('.', '\\.')));
  assert.match(worker, /if \(cached\) return cached/u);
  assert.match(worker, /await fetch\(event\.request, \{ cache: 'no-cache' \}\)/u);
  assert.doesNotMatch(worker, /skipWaiting/u);

  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.length >= 1);
});

test('package and deployment configuration require no paid runtime dependency or token', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.devDependencies ?? {}, {});
  assert.equal(packageJson.engines.node, '22.x');

  const envExample = await read('.env.local.example');
  assert.doesNotMatch(envExample, /^[A-Z][A-Z0-9_]*=/mu);

  const vercel = JSON.parse(await read('vercel.json'));
  const globalHeaderRule = vercel.headers.find(rule => rule.source === '/(.*)');
  assert.ok(globalHeaderRule);
  const headers = Object.fromEntries(globalHeaderRule.headers.map(item => [item.key, item.value]));
  assert.match(headers['Content-Security-Policy'], /connect-src 'self'/u);
  assert.match(headers['Permissions-Policy'], /microphone=\(self\)/u);
});

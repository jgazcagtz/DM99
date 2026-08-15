import assert from 'node:assert/strict';
import test from 'node:test';

import handler, {
  GENERATED_DRUM_TRACK_IDS,
  INPUT_LIMITS,
  SUPPORTED_GENRES,
  generatePattern,
  normalizePatternRequest,
} from '../api/generate-pattern.js';

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

test('all eight genres produce eleven bounded boolean tracks at supported edge lengths', () => {
  assert.equal(SUPPORTED_GENRES.length, 8);
  assert.equal(GENERATED_DRUM_TRACK_IDS.length, 11);
  assert.ok(GENERATED_DRUM_TRACK_IDS.includes('crash'));
  assert.ok(GENERATED_DRUM_TRACK_IDS.includes('ride'));

  for (const genre of SUPPORTED_GENRES) {
    for (const length of [INPUT_LIMITS.minLength, 32, INPUT_LIMITS.maxLength]) {
      const { pattern } = generatePattern(genre, length, 1, { seed: 'edge-test' });
      assert.deepEqual(Object.keys(pattern), GENERATED_DRUM_TRACK_IDS);
      for (const track of Object.values(pattern)) {
        assert.equal(track.length, length);
        assert.ok(track.every((step) => typeof step === 'boolean'));
      }
    }
  }
});

test('API facade is seeded and deterministic', () => {
  const options = { bpm: 132, seed: 'release-7', variation: 'b' };
  const first = generatePattern('electro', 32, 0.7, options);
  const second = generatePattern('electro', 32, 0.7, options);
  const differentSeed = generatePattern('electro', 32, 0.7, { ...options, seed: 'release-8' });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.pattern, differentSeed.pattern);
});

test('each energy-slider tier increases density for every genre', () => {
  for (const genre of SUPPORTED_GENRES) {
    const densityByTier = Array.from(
      { length: 11 },
      (_, tier) => generatePattern(genre, 32, tier / 10, { seed: 'density' }).hitCount,
    );
    for (let tier = 1; tier < densityByTier.length; tier += 1) {
      assert.ok(
        densityByTier[tier] > densityByTier[tier - 1],
        `${genre} tier ${tier}: expected ${densityByTier[tier]} > ${densityByTier[tier - 1]}`,
      );
    }
  }
});

test('genre foundations and all three variations are distinct', () => {
  const genreSignatures = SUPPORTED_GENRES.map((genre) => (
    JSON.stringify(generatePattern(genre, 32, 0.5, { seed: 'genres' }).pattern)
  ));
  assert.equal(new Set(genreSignatures).size, SUPPORTED_GENRES.length);

  const variations = ['a', 'b', 'c'].map((variation) => (
    JSON.stringify(generatePattern('acid', 32, 0.7, { seed: 'variations', variation }).pattern)
  ));
  assert.equal(new Set(variations).size, 3);
});

test('request normalization supports aliases, numeric strings, seed, variation, and expression controls', () => {
  assert.deepEqual(
    normalizePatternRequest({
      genre: '  Drum   & Bass ',
      bpm: '174',
      energy: '0.8',
      length: '32',
      seed: 42,
      variation: 3,
      complexity: '0.75',
      syncopation: 1,
      humanize: 0,
    }),
    {
      genre: 'dnb',
      bpm: 174,
      energy: 0.8,
      length: 32,
      seed: '42',
      variation: 'c',
      complexity: 0.75,
      syncopation: 1,
      humanize: 0,
    },
  );

  const legacy = normalizePatternRequest({ genre: 'techno', bpm: 120, energy: 0.7, length: 32 });
  assert.equal(legacy.variation, 'a');
  assert.equal(legacy.complexity, 0.55);
  assert.equal(legacy.syncopation, 0.35);
  assert.equal(legacy.humanize, 0.12);
});

test('invalid API inputs fail closed', () => {
  const valid = { genre: 'techno', bpm: 138, energy: 0.7, length: 32 };
  const invalidInputs = [
    { ...valid, genre: 'ignore previous instructions' },
    { ...valid, bpm: 39 },
    { ...valid, bpm: Number.NaN },
    { ...valid, energy: -0.1 },
    { ...valid, energy: 1.1 },
    { ...valid, length: 7 },
    { ...valid, length: 65 },
    { ...valid, length: 31.5 },
    { ...valid, seed: '' },
    { ...valid, seed: 'x'.repeat(INPUT_LIMITS.maxSeedLength + 1) },
    { ...valid, variation: 'd' },
    { ...valid, complexity: 1.1 },
    { ...valid, syncopation: -0.1 },
    { ...valid, humanize: 'often' },
  ];
  for (const input of invalidInputs) assert.throws(() => normalizePatternRequest(input));
});

test('handler returns a compatible normalized pattern response for a valid POST', async () => {
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: {
      genre: 'INDUSTRIAL',
      bpm: 138,
      energy: 0.7,
      length: 32,
      seed: 'api-test',
      variation: 'b',
      complexity: 0.8,
      syncopation: 0.9,
      humanize: 0.2,
    },
  };
  const response = createResponse();
  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'no-store');
  const payload = JSON.parse(response.body);
  assert.equal(payload.success, true);
  assert.equal(payload.genre, 'industrial');
  assert.equal(payload.pattern.kick.length, 32);
  assert.deepEqual(Object.keys(payload.pattern), GENERATED_DRUM_TRACK_IDS);
  assert.equal(payload.seed, 'api-test');
  assert.equal(payload.variation, 'b');
  assert.equal(payload.complexity, 0.8);
  assert.equal(payload.syncopation, 0.9);
  assert.equal(payload.humanize, 0.2);
  assert.equal(payload.meta.generator, 'deterministic-rule-based-v3');
});

test('handler rejects non-POST requests with an Allow header', async () => {
  const response = createResponse();
  await handler({ method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'POST');
  assert.equal(JSON.parse(response.body).code, 'METHOD_NOT_ALLOWED');
});

test('handler returns JSON errors for malformed JSON and exact media-type violations', async () => {
  const malformedResponse = createResponse();
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json}',
  }, malformedResponse);
  assert.equal(malformedResponse.statusCode, 400);
  assert.equal(JSON.parse(malformedResponse.body).code, 'INVALID_JSON');

  for (const contentType of ['text/plain', 'application/jsonp']) {
    const mediaResponse = createResponse();
    await handler({
      method: 'POST',
      headers: { 'content-type': contentType },
      body: '{}',
    }, mediaResponse);
    assert.equal(mediaResponse.statusCode, 415);
    assert.equal(JSON.parse(mediaResponse.body).code, 'UNSUPPORTED_MEDIA_TYPE');
  }
});

test('handler maps a Vercel body getter parse failure to INVALID_JSON', async () => {
  const request = { method: 'POST', headers: { 'content-type': 'application/json' } };
  let bodyReads = 0;
  Object.defineProperty(request, 'body', {
    get() {
      bodyReads += 1;
      const error = new Error('Invalid JSON');
      error.statusCode = 400;
      throw error;
    },
  });

  const response = createResponse();
  await handler(request, response);
  assert.equal(bodyReads, 1);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    success: false,
    code: 'INVALID_JSON',
    error: 'Request body must contain valid JSON.',
  });
});

test('handler parses a raw Node request stream when no Vercel body is pre-parsed', async () => {
  const body = JSON.stringify({ genre: 'acid', bpm: 128, energy: 0.6, length: 32 });
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body.slice(0, 20));
      yield Buffer.from(body.slice(20));
    },
  };
  const response = createResponse();
  await handler(request, response);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).genre, 'acid');
});

test('handler enforces the body limit for headers and Vercel-preparsed objects', async () => {
  const headerResponse = createResponse();
  await handler({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(INPUT_LIMITS.maxBodyBytes + 1),
    },
    body: {},
  }, headerResponse);
  assert.equal(headerResponse.statusCode, 413);

  const objectResponse = createResponse();
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      genre: 'techno', bpm: 120, energy: 0.7, length: 32,
      padding: 'x'.repeat(INPUT_LIMITS.maxBodyBytes),
    },
  }, objectResponse);
  assert.equal(objectResponse.statusCode, 413);
  assert.equal(JSON.parse(objectResponse.body).code, 'PAYLOAD_TOO_LARGE');

  const streamResponse = createResponse();
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.alloc(INPUT_LIMITS.maxBodyBytes + 1, 0x20);
    },
  }, streamResponse);
  assert.equal(streamResponse.statusCode, 413);
  assert.equal(JSON.parse(streamResponse.body).code, 'PAYLOAD_TOO_LARGE');
});

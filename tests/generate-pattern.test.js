import assert from 'node:assert/strict';
import test from 'node:test';

import handler, {
  INPUT_LIMITS,
  SUPPORTED_GENRES,
  generatePattern,
  normalizePatternRequest,
} from '../api/generate-pattern.js';

const TRACK_NAMES = [
  'kick',
  'snare',
  'hihatClosed',
  'hihatOpened',
  'clap',
  'tom',
  'perc1',
  'perc2',
  'perc3',
];

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

test('all genres produce bounded boolean tracks at every supported edge length', () => {
  for (const genre of SUPPORTED_GENRES) {
    for (const length of [INPUT_LIMITS.minLength, 32, INPUT_LIMITS.maxLength]) {
      const { pattern } = generatePattern(genre, length, 1);
      assert.deepEqual(Object.keys(pattern), TRACK_NAMES);

      for (const track of Object.values(pattern)) {
        assert.equal(track.length, length);
        assert.ok(track.every((step) => typeof step === 'boolean'));
      }
    }
  }
});

test('generation is deterministic', () => {
  const first = generatePattern('techno', 32, 0.7);
  const second = generatePattern('techno', 32, 0.7);
  assert.deepEqual(first, second);
});

test('each energy-slider step visibly increases density for every genre', () => {
  for (const genre of SUPPORTED_GENRES) {
    const densityByTier = Array.from(
      { length: 11 },
      (_, tier) => generatePattern(genre, 32, tier / 10).hitCount,
    );

    for (let tier = 1; tier < densityByTier.length; tier += 1) {
      assert.ok(
        densityByTier[tier] > densityByTier[tier - 1],
        `${genre} tier ${tier}: expected ${densityByTier[tier]} > ${densityByTier[tier - 1]}`,
      );
    }
  }
});

test('genre foundations are musically distinct', () => {
  const signatures = SUPPORTED_GENRES.map((genre) => {
    const { pattern } = generatePattern(genre, 32, 0.5);
    return JSON.stringify(pattern);
  });

  assert.equal(new Set(signatures).size, SUPPORTED_GENRES.length);
});

test('request normalization trims genres, accepts safe numeric strings, and aliases D&B', () => {
  assert.deepEqual(
    normalizePatternRequest({ genre: '  Drum   & Bass ', bpm: '174', energy: '0.8', length: '32' }),
    { genre: 'dnb', bpm: 174, energy: 0.8, length: 32 },
  );
});

test('invalid inputs fail closed', () => {
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
  ];

  for (const input of invalidInputs) {
    assert.throws(() => normalizePatternRequest(input));
  }
});

test('handler returns a normalized pattern response for a valid POST', async () => {
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { genre: 'TECHNO', bpm: 138, energy: 0.7, length: 32 },
  };
  const response = createResponse();

  await handler(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  const payload = JSON.parse(response.body);
  assert.equal(payload.success, true);
  assert.equal(payload.genre, 'techno');
  assert.equal(payload.pattern.kick.length, 32);
  assert.equal(payload.meta.generator, 'deterministic-rule-based-v2');
});

test('handler rejects non-POST requests with an Allow header', async () => {
  const response = createResponse();
  await handler({ method: 'GET', headers: {} }, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'POST');
  assert.equal(JSON.parse(response.body).code, 'METHOD_NOT_ALLOWED');
});

test('handler returns JSON errors for invalid JSON and media types', async () => {
  const malformedResponse = createResponse();
  await handler(
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json}',
    },
    malformedResponse,
  );
  assert.equal(malformedResponse.statusCode, 400);
  assert.equal(JSON.parse(malformedResponse.body).code, 'INVALID_JSON');

  const mediaResponse = createResponse();
  await handler(
    { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' },
    mediaResponse,
  );
  assert.equal(mediaResponse.statusCode, 415);
  assert.equal(JSON.parse(mediaResponse.body).code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('handler maps a Vercel body getter parse failure to INVALID_JSON', async () => {
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  };
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

test('handler rejects oversized bodies before parsing them', async () => {
  const response = createResponse();
  await handler(
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(INPUT_LIMITS.maxBodyBytes + 1),
      },
      body: {},
    },
    response,
  );

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).code, 'PAYLOAD_TOO_LARGE');
});

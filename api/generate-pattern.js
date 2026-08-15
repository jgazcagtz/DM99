const TRACK_NAMES = Object.freeze([
  'kick',
  'snare',
  'hihatClosed',
  'hihatOpened',
  'clap',
  'tom',
  'perc1',
  'perc2',
  'perc3',
]);

export const SUPPORTED_GENRES = Object.freeze(['techno', 'house', 'trance', 'dnb']);

export const INPUT_LIMITS = Object.freeze({
  minBpm: 40,
  maxBpm: 240,
  minEnergy: 0,
  maxEnergy: 1,
  minLength: 8,
  maxLength: 64,
  maxBodyBytes: 4_096,
});

const GENRE_ALIASES = new Map([
  ['techno', 'techno'],
  ['house', 'house'],
  ['trance', 'trance'],
  ['dnb', 'dnb'],
  ['d&b', 'dnb'],
  ['drum & bass', 'dnb'],
  ['drum and bass', 'dnb'],
  ['drum n bass', 'dnb'],
  ["drum'n'bass", 'dnb'],
]);

class RequestError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function createEmptyPattern(length) {
  return Object.fromEntries(
    TRACK_NAMES.map((trackName) => [trackName, Array(length).fill(false)]),
  );
}

function markBarPositions(pattern, trackName, positions, length) {
  const track = pattern[trackName];

  for (let barStart = 0; barStart < length; barStart += 16) {
    for (const position of positions) {
      const step = barStart + position;
      if (step >= 0 && step < length) {
        track[step] = true;
      }
    }
  }
}

function markEvery(pattern, trackName, start, interval, length) {
  for (let step = start; step < length; step += interval) {
    if (step >= 0) {
      pattern[trackName][step] = true;
    }
  }
}

function applyEnergyLayers(pattern, layers, energyTier, length) {
  for (let index = 0; index < energyTier; index += 1) {
    const layer = layers[index];
    if (!layer) continue;

    for (const [trackName, positions] of layer) {
      markBarPositions(pattern, trackName, positions, length);
    }
  }
}

const ENERGY_LAYERS = Object.freeze({
  techno: [
    [['hihatClosed', [2, 6, 10, 14]]],
    [['clap', [4, 12]]],
    [['perc1', [7, 15]]],
    [['hihatClosed', [0, 4, 8, 12]]],
    [['hihatOpened', [6, 14]]],
    [['perc2', [3, 11]]],
    [['hihatClosed', [1, 5, 9, 13]]],
    [['tom', [15]], ['kick', [10]]],
    [['perc3', [14]], ['snare', [15]]],
    [['hihatClosed', [3, 7, 11, 15]], ['kick', [14]]],
  ],
  house: [
    [['hihatClosed', [2, 6, 10, 14]]],
    [['snare', [4, 12]]],
    [['perc1', [3, 7, 11, 15]]],
    [['hihatClosed', [0, 4, 8, 12]]],
    [['hihatOpened', [6, 14]]],
    [['perc2', [5, 13]]],
    [['hihatClosed', [1, 5, 9, 13]]],
    [['kick', [11]], ['tom', [15]]],
    [['perc3', [10, 14]], ['hihatOpened', [2, 10]]],
    [['kick', [15]], ['snare', [14]], ['hihatClosed', [3, 7, 11, 15]]],
  ],
  trance: [
    [['hihatClosed', [2, 6, 10, 14]]],
    [['clap', [4, 12]]],
    [['hihatClosed', [1, 5, 9, 13]]],
    [['hihatOpened', [6, 14]]],
    [['perc1', [3, 7, 11, 15]]],
    [['hihatClosed', [3, 7, 11, 15]]],
    [['tom', [15]], ['perc2', [14]]],
    [['hihatOpened', [2, 10]]],
    [['snare', [13, 14, 15]], ['kick', [14]]],
    [['perc3', [2, 6, 10, 14]], ['tom', [7]]],
  ],
  dnb: [
    [['hihatClosed', [0, 4, 8, 12]]],
    [['hihatClosed', [2, 6, 10, 14]]],
    [['clap', [4, 12]]],
    [['perc1', [3, 7, 11, 15]]],
    [['kick', [14]]],
    [['hihatClosed', [1, 5, 9, 13]]],
    [['hihatOpened', [7, 15]], ['tom', [14]]],
    [['hihatClosed', [3, 7, 11, 15]]],
    [['kick', [3, 11, 15]], ['snare', [9, 14]]],
    [['perc2', [1, 5, 9, 13]], ['perc3', [15]]],
  ],
});

function addGenreFoundation(pattern, genre, length) {
  switch (genre) {
    case 'techno':
      markEvery(pattern, 'kick', 0, 4, length);
      markBarPositions(pattern, 'snare', [4, 12], length);
      break;
    case 'house':
      markEvery(pattern, 'kick', 0, 4, length);
      markBarPositions(pattern, 'clap', [4, 12], length);
      break;
    case 'trance':
      markEvery(pattern, 'kick', 0, 4, length);
      markBarPositions(pattern, 'snare', [4, 12], length);
      break;
    case 'dnb':
      markBarPositions(pattern, 'kick', [0, 6, 10], length);
      markBarPositions(pattern, 'snare', [4, 12], length);
      break;
    default:
      throw new RequestError(400, 'UNSUPPORTED_GENRE', 'Unsupported genre.');
  }
}

function countHits(pattern) {
  return Object.values(pattern).reduce(
    (total, track) => total + track.filter(Boolean).length,
    0,
  );
}

/**
 * Create a deterministic drum pattern. Energy is divided into ten additive
 * layers, so raising it never removes hits and visibly increases density.
 */
export function generatePattern(genre, length, energy) {
  if (!SUPPORTED_GENRES.includes(genre)) {
    throw new RequestError(400, 'UNSUPPORTED_GENRE', 'Unsupported genre.');
  }

  if (!Number.isInteger(length) || length < INPUT_LIMITS.minLength || length > INPUT_LIMITS.maxLength) {
    throw new RequestError(400, 'INVALID_LENGTH', 'Length is outside the supported range.');
  }

  if (!Number.isFinite(energy) || energy < INPUT_LIMITS.minEnergy || energy > INPUT_LIMITS.maxEnergy) {
    throw new RequestError(400, 'INVALID_ENERGY', 'Energy must be between 0 and 1.');
  }

  const pattern = createEmptyPattern(length);
  const energyTier = Math.min(10, Math.floor((energy * 10) + Number.EPSILON));

  addGenreFoundation(pattern, genre, length);
  applyEnergyLayers(pattern, ENERGY_LAYERS[genre], energyTier, length);

  return {
    pattern,
    energyTier,
    hitCount: countHits(pattern),
  };
}

function parseNumericField(value, fieldName) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const sanitized = value.trim();
    if (/^(?:\d+\.?\d*|\.\d+)$/.test(sanitized)) {
      return Number(sanitized);
    }
  }

  throw new RequestError(400, 'INVALID_INPUT', `${fieldName} must be a number.`, {
    field: fieldName,
  });
}

export function normalizePatternRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RequestError(400, 'INVALID_INPUT', 'Request body must be a JSON object.');
  }

  if (typeof input.genre !== 'string' || input.genre.length > 32) {
    throw new RequestError(400, 'INVALID_GENRE', 'genre must be a supported genre name.', {
      supported: SUPPORTED_GENRES,
    });
  }

  const genreKey = input.genre.trim().toLowerCase().replace(/\s+/g, ' ');
  const genre = GENRE_ALIASES.get(genreKey);
  if (!genre) {
    throw new RequestError(400, 'INVALID_GENRE', 'genre must be one of: techno, house, trance, dnb.', {
      supported: SUPPORTED_GENRES,
    });
  }

  const bpm = parseNumericField(input.bpm, 'bpm');
  if (!Number.isFinite(bpm) || bpm < INPUT_LIMITS.minBpm || bpm > INPUT_LIMITS.maxBpm) {
    throw new RequestError(
      400,
      'INVALID_BPM',
      `bpm must be between ${INPUT_LIMITS.minBpm} and ${INPUT_LIMITS.maxBpm}.`,
      { field: 'bpm' },
    );
  }

  const energy = parseNumericField(input.energy, 'energy');
  if (!Number.isFinite(energy) || energy < INPUT_LIMITS.minEnergy || energy > INPUT_LIMITS.maxEnergy) {
    throw new RequestError(400, 'INVALID_ENERGY', 'energy must be between 0 and 1.', {
      field: 'energy',
    });
  }

  const length = parseNumericField(input.length, 'length');
  if (
    !Number.isInteger(length)
    || length < INPUT_LIMITS.minLength
    || length > INPUT_LIMITS.maxLength
  ) {
    throw new RequestError(
      400,
      'INVALID_LENGTH',
      `length must be a whole number between ${INPUT_LIMITS.minLength} and ${INPUT_LIMITS.maxLength}.`,
      { field: 'length' },
    );
  }

  return {
    genre,
    bpm: Math.round(bpm * 10) / 10,
    energy: Math.round(energy * 1_000) / 1_000,
    length,
  };
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  for (const [header, value] of Object.entries(extraHeaders)) {
    response.setHeader(header, value);
  }

  response.end(JSON.stringify(payload));
}

function parseJson(value) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return value;
  }

  const source = Buffer.isBuffer(value) ? value.toString('utf8') : value;
  if (typeof source !== 'string' || source.trim() === '') {
    throw new RequestError(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
  }

  try {
    return JSON.parse(source);
  } catch {
    throw new RequestError(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
  }
}

async function readJsonBody(request) {
  let parsedBody;

  try {
    // Vercel exposes parsed bodies through a getter. Malformed JSON can make
    // that getter throw before the handler receives a body value.
    parsedBody = request.body;
  } catch (error) {
    const isInvalidJson = error?.statusCode === 400
      && /invalid\s+json/i.test(String(error?.message || ''));

    if (isInvalidJson) {
      throw new RequestError(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
    }

    throw error;
  }

  if (parsedBody !== undefined && parsedBody !== null) {
    return parseJson(parsedBody);
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > INPUT_LIMITS.maxBodyBytes) {
      throw new RequestError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }

    chunks.push(buffer);
  }

  return parseJson(Buffer.concat(chunks));
}

function headerValue(request, name) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/** Vercel Node.js Function handler for POST /api/generate-pattern. */
export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return sendJson(
      response,
      405,
      {
        success: false,
        code: 'METHOD_NOT_ALLOWED',
        error: 'Only POST requests are supported.',
      },
      { Allow: 'POST' },
    );
  }

  try {
    const contentLength = Number(headerValue(request, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > INPUT_LIMITS.maxBodyBytes) {
      throw new RequestError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }

    const contentType = headerValue(request, 'content-type');
    if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
      throw new RequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
    }

    const body = await readJsonBody(request);
    const input = normalizePatternRequest(body);
    const generated = generatePattern(input.genre, input.length, input.energy);

    return sendJson(response, 200, {
      success: true,
      pattern: generated.pattern,
      genre: input.genre,
      bpm: input.bpm,
      energy: input.energy,
      length: input.length,
      meta: {
        energyTier: generated.energyTier,
        hitCount: generated.hitCount,
        generator: 'deterministic-rule-based-v2',
      },
      message: 'Pattern generated successfully',
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return sendJson(response, error.status, {
        success: false,
        code: error.code,
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    console.error('Pattern generation failed', error);
    return sendJson(response, 500, {
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Pattern generation failed.',
    });
  }
}

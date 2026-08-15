import {
  DEFAULT_GENERATOR_SETTINGS,
  GENERATED_DRUM_TRACK_IDS,
  PATTERN_LIMITS,
  PATTERN_VARIATIONS,
  SUPPORTED_GENRES,
  normalizeGenreId,
  normalizeVariationId,
} from '../src/pattern-constants.js';
import {
  generatePattern as generateExpressivePattern,
  toBooleanPattern,
} from '../src/pattern-engine.js';

export { GENERATED_DRUM_TRACK_IDS, SUPPORTED_GENRES };

export const INPUT_LIMITS = PATTERN_LIMITS;

class RequestError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parseNumericField(value, fieldName) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const sanitized = value.trim();
    if (/^(?:\d+\.?\d*|\.\d+)$/.test(sanitized)) return Number(sanitized);
  }

  throw new RequestError(400, 'INVALID_INPUT', `${fieldName} must be a number.`, {
    field: fieldName,
  });
}

function normalizeSeed(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
    throw new RequestError(400, 'INVALID_SEED', 'seed must be a non-empty string or finite number.', {
      field: 'seed',
    });
  }

  const seed = String(value).trim();
  if (!seed || seed.length > INPUT_LIMITS.maxSeedLength) {
    throw new RequestError(
      400,
      'INVALID_SEED',
      `seed must contain between 1 and ${INPUT_LIMITS.maxSeedLength} characters.`,
      { field: 'seed' },
    );
  }
  return seed;
}

function normalizeOptionalUnitField(value, fieldName, fallback) {
  if (value === undefined) return fallback;
  const parsed = parseNumericField(value, fieldName);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new RequestError(400, `INVALID_${fieldName.toUpperCase()}`, `${fieldName} must be between 0 and 1.`, {
      field: fieldName,
    });
  }
  return Math.round(parsed * 1_000) / 1_000;
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

  const genre = normalizeGenreId(input.genre);
  if (!genre) {
    throw new RequestError(
      400,
      'INVALID_GENRE',
      `genre must be one of: ${SUPPORTED_GENRES.join(', ')}.`,
      { supported: SUPPORTED_GENRES },
    );
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
  if (!Number.isInteger(length) || length < INPUT_LIMITS.minLength || length > INPUT_LIMITS.maxLength) {
    throw new RequestError(
      400,
      'INVALID_LENGTH',
      `length must be a whole number between ${INPUT_LIMITS.minLength} and ${INPUT_LIMITS.maxLength}.`,
      { field: 'length' },
    );
  }

  const normalizedBpm = Math.round(bpm * 10) / 10;
  const normalizedEnergy = Math.round(energy * 1_000) / 1_000;
  const variation = input.variation === undefined
    ? 'a'
    : normalizeVariationId(input.variation);
  if (!variation) {
    throw new RequestError(
      400,
      'INVALID_VARIATION',
      `variation must be one of: ${PATTERN_VARIATIONS.join(', ')}.`,
      { field: 'variation', supported: PATTERN_VARIATIONS },
    );
  }

  return {
    genre,
    bpm: normalizedBpm,
    energy: normalizedEnergy,
    length,
    seed: normalizeSeed(input.seed, `${genre}:${normalizedBpm}:${length}`),
    variation,
    complexity: normalizeOptionalUnitField(input.complexity, 'complexity', DEFAULT_GENERATOR_SETTINGS.complexity),
    syncopation: normalizeOptionalUnitField(input.syncopation, 'syncopation', DEFAULT_GENERATOR_SETTINGS.syncopation),
    humanize: normalizeOptionalUnitField(input.humanize, 'humanize', DEFAULT_GENERATOR_SETTINGS.humanize),
  };
}

/**
 * Backwards-compatible boolean-pattern facade over the expressive shared
 * pattern engine. Existing callers may keep the original three arguments.
 */
export function generatePattern(genre, length, energy, options = {}) {
  const generated = generateExpressivePattern({
    genre,
    length,
    energy,
    bpm: options.bpm ?? 120,
    seed: options.seed,
    variation: options.variation ?? DEFAULT_GENERATOR_SETTINGS.variation,
    complexity: options.complexity ?? DEFAULT_GENERATOR_SETTINGS.complexity,
    syncopation: options.syncopation ?? DEFAULT_GENERATOR_SETTINGS.syncopation,
    humanize: options.humanize ?? DEFAULT_GENERATOR_SETTINGS.humanize,
    locks: options.locks,
    currentPattern: options.currentPattern,
  });

  return {
    pattern: toBooleanPattern(generated.pattern, generated.length),
    energyTier: generated.energyTier,
    hitCount: generated.hitCount,
    seed: generated.seed,
    variation: generated.variation,
    complexity: generated.complexity,
    syncopation: generated.syncopation,
    humanize: generated.humanize,
  };
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  for (const [header, value] of Object.entries(extraHeaders)) response.setHeader(header, value);
  response.end(JSON.stringify(payload));
}

function invalidJson() {
  return new RequestError(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
}

function serializedBodySize(value) {
  try {
    if (Buffer.isBuffer(value)) return value.length;
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw invalidJson();
    return Buffer.byteLength(serialized, 'utf8');
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw invalidJson();
  }
}

function parseJson(value) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  const source = Buffer.isBuffer(value) ? value.toString('utf8') : value;
  if (typeof source !== 'string' || source.trim() === '') throw invalidJson();
  try {
    return JSON.parse(source);
  } catch {
    throw invalidJson();
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
    if (isInvalidJson) throw invalidJson();
    throw error;
  }

  if (parsedBody !== undefined && parsedBody !== null) {
    if (serializedBodySize(parsedBody) > INPUT_LIMITS.maxBodyBytes) {
      throw new RequestError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }
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
    return sendJson(response, 405, {
      success: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Only POST requests are supported.',
    }, { Allow: 'POST' });
  }

  try {
    const contentLength = Number(headerValue(request, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > INPUT_LIMITS.maxBodyBytes) {
      throw new RequestError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }

    const contentType = headerValue(request, 'content-type');
    const mediaType = typeof contentType === 'string'
      ? contentType.split(';', 1)[0].trim().toLowerCase()
      : '';
    if (mediaType !== 'application/json') {
      throw new RequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
    }

    const body = await readJsonBody(request);
    const input = normalizePatternRequest(body);
    const generated = generatePattern(input.genre, input.length, input.energy, input);

    return sendJson(response, 200, {
      success: true,
      pattern: generated.pattern,
      genre: input.genre,
      bpm: input.bpm,
      energy: input.energy,
      length: input.length,
      seed: generated.seed,
      variation: generated.variation,
      complexity: generated.complexity,
      syncopation: generated.syncopation,
      humanize: generated.humanize,
      meta: {
        energyTier: generated.energyTier,
        hitCount: generated.hitCount,
        generator: 'deterministic-rule-based-v3',
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

import {
  DEFAULT_GENERATOR_SETTINGS,
  DEFAULT_SEQUENCE_LENGTH,
  GENERATED_DRUM_TRACK_IDS,
  PATTERN_LIMITS,
  PATTERN_TRANSFORMS,
  PATTERN_VARIATIONS,
  SUPPORTED_GENRES,
  normalizeGenreId,
  normalizeVariationId,
} from './pattern-constants.js';
import { createDefaultStep, normalizeSequence, normalizeStep } from './project-state.js';

const GENRE_FOUNDATIONS = Object.freeze({
  techno: Object.freeze({ kick: [0, 4, 8, 12], snare: [4, 12] }),
  house: Object.freeze({ kick: [0, 4, 8, 12], clap: [4, 12], hihatClosed: [2, 6, 10, 14] }),
  trance: Object.freeze({ kick: [0, 4, 8, 12], snare: [4, 12], hihatClosed: [2, 6, 10, 14] }),
  dnb: Object.freeze({ kick: [0, 6, 10], snare: [4, 12], hihatClosed: [2, 6, 10, 14] }),
  electro: Object.freeze({ kick: [0, 7, 10], snare: [4, 12], clap: [12], hihatClosed: [2, 6, 11, 14] }),
  industrial: Object.freeze({ kick: [0, 3, 8, 11], snare: [4, 12], tom: [2, 10] }),
  acid: Object.freeze({ kick: [0, 4, 8, 12], clap: [4, 12], perc1: [3, 11] }),
  ambient: Object.freeze({ kick: [0], snare: [12], ride: [8] }),
});

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
    [['perc3', [14]], ['crash', [0]]],
    [['hihatClosed', [3, 7, 11, 15]], ['ride', [8]]],
  ],
  house: [
    [['snare', [4, 12]]],
    [['perc1', [3, 7, 11, 15]]],
    [['hihatClosed', [0, 4, 8, 12]]],
    [['hihatOpened', [6, 14]]],
    [['perc2', [5, 13]]],
    [['hihatClosed', [1, 5, 9, 13]]],
    [['kick', [11]], ['tom', [15]]],
    [['perc3', [10, 14]], ['hihatOpened', [2, 10]]],
    [['crash', [0]], ['ride', [8]]],
    [['kick', [15]], ['snare', [14]], ['hihatClosed', [3, 7, 11, 15]]],
  ],
  trance: [
    [['clap', [4, 12]]],
    [['hihatClosed', [1, 5, 9, 13]]],
    [['hihatOpened', [6, 14]]],
    [['perc1', [3, 7, 11, 15]]],
    [['hihatClosed', [3, 7, 11, 15]]],
    [['tom', [15]], ['perc2', [14]]],
    [['hihatOpened', [2, 10]]],
    [['snare', [13, 14, 15]], ['kick', [14]]],
    [['crash', [0]], ['ride', [4, 12]]],
    [['perc3', [2, 6, 10, 14]], ['tom', [7]]],
  ],
  dnb: [
    [['hihatClosed', [0, 4, 8, 12]]],
    [['clap', [4, 12]]],
    [['perc1', [3, 7, 11, 15]]],
    [['kick', [14]]],
    [['hihatClosed', [1, 5, 9, 13]]],
    [['hihatOpened', [7, 15]], ['tom', [14]]],
    [['hihatClosed', [3, 7, 11, 15]]],
    [['kick', [3, 11, 15]], ['snare', [9, 14]]],
    [['perc2', [1, 5, 9, 13]], ['perc3', [15]]],
    [['crash', [0]], ['ride', [6, 14]]],
  ],
  electro: [
    [['perc1', [3, 11]]],
    [['hihatOpened', [6, 14]]],
    [['cowbell', [2, 10]]],
    [['perc2', [1, 9]]],
    [['kick', [14]], ['snare', [15]]],
    [['hihatClosed', [0, 4, 8, 12]]],
    [['tom', [7, 15]]],
    [['perc3', [5, 13]]],
    [['crash', [0]], ['ride', [8]]],
    [['hihatClosed', [1, 3, 5, 9, 13, 15]]],
  ],
  industrial: [
    [['hihatClosed', [2, 6, 10, 14]]],
    [['clap', [4, 12]]],
    [['tom', [6, 14]]],
    [['perc2', [1, 5, 9, 13]]],
    [['kick', [5, 14]]],
    [['hihatOpened', [3, 11]]],
    [['perc1', [2, 7, 10, 15]]],
    [['snare', [1, 9, 15]]],
    [['crash', [0, 8]]],
    [['ride', [2, 6, 10, 14]], ['perc3', [3, 7, 11, 15]]],
  ],
  acid: [
    [['hihatClosed', [2, 6, 10, 14]]],
    [['snare', [4, 12]]],
    [['hihatClosed', [1, 5, 9, 13]]],
    [['perc2', [7, 15]]],
    [['hihatOpened', [6, 14]]],
    [['kick', [10, 15]]],
    [['perc3', [2, 10]]],
    [['tom', [3, 11]]],
    [['crash', [0]], ['ride', [8]]],
    [['hihatClosed', [3, 7, 11, 15]], ['clap', [14]]],
  ],
  ambient: [
    [['hihatOpened', [6]]],
    [['perc1', [3]]],
    [['ride', [14]]],
    [['tom', [10]]],
    [['perc2', [5, 13]]],
    [['hihatClosed', [2, 10]]],
    [['crash', [0]]],
    [['perc3', [7, 15]]],
    [['snare', [4]]],
    [['hihatOpened', [2, 6, 10, 14]]],
  ],
});

const ANCHOR_TRACKS = new Set(['kick', 'snare', 'clap']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertLength(value) {
  if (!Number.isInteger(value) || value < PATTERN_LIMITS.minLength || value > PATTERN_LIMITS.maxLength) {
    throw new RangeError(`length must be an integer between ${PATTERN_LIMITS.minLength} and ${PATTERN_LIMITS.maxLength}`);
  }
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeUnit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : fallback;
}

function resolvePatternLength(pattern, requestedLength) {
  if (requestedLength !== undefined) return assertLength(Number(requestedLength));
  const inferred = GENERATED_DRUM_TRACK_IDS
    .map((trackId) => pattern?.[trackId])
    .find(Array.isArray)?.length;
  return assertLength(inferred ?? DEFAULT_SEQUENCE_LENGTH);
}

function normalizedSeed(value, fallback = 'dm99') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  const seed = String(value).trim();
  return (seed || fallback).slice(0, PATTERN_LIMITS.maxSeedLength);
}

export function hashSeed(value) {
  const source = normalizedSeed(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createEmptyPattern(length = DEFAULT_SEQUENCE_LENGTH) {
  const safeLength = assertLength(Number(length));
  return Object.fromEntries(GENERATED_DRUM_TRACK_IDS.map((trackId) => [
    trackId,
    Array.from({ length: safeLength }, () => createDefaultStep()),
  ]));
}

export function normalizePattern(pattern, length) {
  const safeLength = resolvePatternLength(pattern, length);
  const source = isRecord(pattern) ? pattern : {};
  return Object.fromEntries(GENERATED_DRUM_TRACK_IDS.map((trackId) => [
    trackId,
    normalizeSequence(source[trackId], safeLength),
  ]));
}

export function toBooleanPattern(pattern, length) {
  const normalized = normalizePattern(pattern, length);
  return Object.fromEntries(GENERATED_DRUM_TRACK_IDS.map((trackId) => [
    trackId,
    normalized[trackId].map((step) => step.active === true),
  ]));
}

export function countPatternHits(pattern) {
  const normalized = normalizePattern(pattern);
  return Object.values(normalized).reduce(
    (total, track) => total + track.filter((step) => step.active).length,
    0,
  );
}

function variationPosition(position, trackId, variation) {
  if (ANCHOR_TRACKS.has(trackId) || variation === 'a') return position;
  if (variation === 'b') return (position + 1) % 16;
  return (15 - position + 16) % 16;
}

function markBarPositions(pattern, trackId, positions, variation) {
  const track = pattern[trackId];
  if (!track) return;
  for (let barStart = 0; barStart < track.length; barStart += 16) {
    for (const position of positions) {
      const step = barStart + variationPosition(position, trackId, variation);
      if (step >= 0 && step < track.length) track[step].active = true;
    }
  }
}

function applyFoundation(pattern, genre, variation) {
  for (const [trackId, positions] of Object.entries(GENRE_FOUNDATIONS[genre])) {
    markBarPositions(pattern, trackId, positions, variation);
  }
}

function applyEnergyLayer(pattern, genre, layerIndex, variation) {
  for (const [trackId, positions] of ENERGY_LAYERS[genre][layerIndex] || []) {
    // Historical configs may name a non-generated percussion voice. Route it
    // to perc2 so the canonical output always remains the same eleven tracks.
    const canonicalTrack = trackId === 'cowbell' ? 'perc2' : trackId;
    markBarPositions(pattern, canonicalTrack, positions, variation);
  }
}

function addSeededEnergyHits(pattern, seedKey, energyTier, variation, complexity, syncopation) {
  if (energyTier === 0) return;
  const random = createSeededRandom(`${seedKey}:density`);
  const candidates = [];
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    for (let step = 0; step < pattern[trackId].length; step += 1) {
      candidates.push([trackId, step]);
    }
  }

  const ordered = candidates
    .map(([trackId, step]) => {
      const offGrid = step % 4 !== 0;
      const preference = offGrid ? syncopation : (1 - syncopation);
      return { trackId, step, score: random() + (preference * 1.5) };
    })
    .sort((left, right) => right.score - left.score)
    .map(({ trackId, step }) => [trackId, step]);
  const perTier = Math.max(1, Math.ceil(pattern.kick.length / 16))
    + PATTERN_VARIATIONS.indexOf(variation)
    + Math.round(complexity * 2);
  const target = energyTier * perTier;
  let added = 0;
  for (const [trackId, step] of ordered) {
    if (pattern[trackId][step].active) continue;
    pattern[trackId][step].active = true;
    added += 1;
    if (added >= target) break;
  }
}

function decorateActiveSteps(pattern, seedKey, energy, complexity, humanize) {
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    for (let stepIndex = 0; stepIndex < pattern[trackId].length; stepIndex += 1) {
      if (!pattern[trackId][stepIndex].active) continue;
      const random = createSeededRandom(`${seedKey}:${trackId}:${stepIndex}`);
      const accent = stepIndex % 4 === 0 && ['kick', 'snare', 'clap', 'crash'].includes(trackId);
      const canRatchet = ['hihatClosed', 'hihatOpened', 'perc1', 'perc2', 'perc3', 'tom'].includes(trackId);
      const ratchetChance = energy * complexity * 0.45;
      const velocityCenter = accent ? 1 : 0.86;
      const velocityRange = accent ? 0 : 0.18 * humanize;
      pattern[trackId][stepIndex] = normalizeStep({
        ...pattern[trackId][stepIndex],
        active: true,
        velocity: velocityCenter + ((random() - 0.5) * 2 * velocityRange),
        probability: accent ? 1 : 0.9 + (random() * 0.1),
        ratchet: canRatchet && random() < ratchetChance
          ? (complexity >= 0.9 && random() < 0.25 ? 3 : 2)
          : 1,
        nudgeMs: accent ? 0 : Math.round((random() - 0.5) * 40 * humanize),
        accent,
        slide: trackId === 'tom' && energy >= 0.7 && random() > 0.86,
      });
    }
  }
}

function normalizeLocks(locks) {
  const source = isRecord(locks) ? locks : {};
  return Object.fromEntries(GENERATED_DRUM_TRACK_IDS.map((trackId) => [
    trackId,
    source[trackId] === true,
  ]));
}

function copyLockedTracks(pattern, currentPattern, locks, length) {
  const normalizedCurrent = normalizePattern(currentPattern, length);
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (locks[trackId]) pattern[trackId] = normalizedCurrent[trackId];
  }
}

export function generatePattern(options = {}) {
  if (!isRecord(options)) throw new TypeError('Generation options must be an object.');
  const genre = normalizeGenreId(options.genre ?? 'techno');
  if (!genre) throw new RangeError(`Unsupported genre. Expected one of: ${SUPPORTED_GENRES.join(', ')}`);

  const length = assertLength(Number(options.length ?? DEFAULT_SEQUENCE_LENGTH));
  const bpm = Number(options.bpm ?? 120);
  if (!Number.isFinite(bpm) || bpm < PATTERN_LIMITS.minBpm || bpm > PATTERN_LIMITS.maxBpm) {
    throw new RangeError(`bpm must be between ${PATTERN_LIMITS.minBpm} and ${PATTERN_LIMITS.maxBpm}`);
  }

  const energy = Number(options.energy ?? DEFAULT_GENERATOR_SETTINGS.energy);
  if (!Number.isFinite(energy) || energy < PATTERN_LIMITS.minEnergy || energy > PATTERN_LIMITS.maxEnergy) {
    throw new RangeError('energy must be between 0 and 1');
  }

  const complexity = Number(options.complexity ?? DEFAULT_GENERATOR_SETTINGS.complexity);
  const syncopation = Number(options.syncopation ?? DEFAULT_GENERATOR_SETTINGS.syncopation);
  const humanize = Number(options.humanize ?? DEFAULT_GENERATOR_SETTINGS.humanize);
  for (const [name, value] of Object.entries({ complexity, syncopation, humanize })) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${name} must be between 0 and 1`);
    }
  }

  const variation = normalizeVariationId(options.variation ?? DEFAULT_GENERATOR_SETTINGS.variation);
  if (!variation) throw new RangeError('variation must be one of: a, b, c');
  const seed = normalizedSeed(options.seed, `${genre}:${bpm}:${length}`);
  const energyTier = Math.min(10, Math.floor((energy * 10) + Number.EPSILON));
  const seedKey = `${genre}:${bpm}:${length}:${variation}:${seed}`;
  const locks = normalizeLocks(options.locks);
  const pattern = createEmptyPattern(length);

  applyFoundation(pattern, genre, variation);
  for (let layer = 0; layer < energyTier; layer += 1) {
    applyEnergyLayer(pattern, genre, layer, variation);
  }
  addSeededEnergyHits(pattern, seedKey, energyTier, variation, complexity, syncopation);
  decorateActiveSteps(pattern, seedKey, energy, complexity, humanize);
  copyLockedTracks(pattern, options.currentPattern, locks, length);

  const hitCount = Object.values(pattern).reduce(
    (total, track) => total + track.filter((step) => step.active).length,
    0,
  );

  return {
    pattern,
    genre,
    bpm: Math.round(bpm * 10) / 10,
    energy: Math.round(energy * 1_000) / 1_000,
    complexity: Math.round(complexity * 1_000) / 1_000,
    syncopation: Math.round(syncopation * 1_000) / 1_000,
    humanize: Math.round(humanize * 1_000) / 1_000,
    length,
    seed,
    variation,
    energyTier,
    hitCount,
    lockedTracks: GENERATED_DRUM_TRACK_IDS.filter((trackId) => locks[trackId]),
  };
}

export function generatePatternVariations(options = {}) {
  if (!isRecord(options)) throw new TypeError('Generation options must be an object.');
  return PATTERN_VARIATIONS.map((variation) => generatePattern({ ...options, variation }));
}

function transformContext(pattern, options = {}, defaultTracks = GENERATED_DRUM_TRACK_IDS) {
  const normalized = normalizePattern(pattern, options.length);
  const length = normalized.kick.length;
  const requestedTracks = Array.isArray(options.trackIds) ? options.trackIds : defaultTracks;
  const selectedTracks = new Set(requestedTracks.filter((trackId) => GENERATED_DRUM_TRACK_IDS.includes(trackId)));
  const locks = normalizeLocks(options.locks);
  return { normalized, length, selectedTracks, locks };
}

function shouldTransform(trackId, context) {
  return context.selectedTracks.has(trackId) && !context.locks[trackId];
}

function replaceTrack(pattern, trackId, steps) {
  pattern[trackId] = steps.map((step) => normalizeStep(step));
}

export function rotatePattern(pattern, amount = 1, options = {}) {
  const context = transformContext(pattern, options);
  const offsetValue = Number(amount);
  if (!Number.isFinite(offsetValue)) throw new TypeError('rotate amount must be a finite number');
  const offset = ((Math.trunc(offsetValue) % context.length) + context.length) % context.length;

  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (!shouldTransform(trackId, context)) continue;
    const source = context.normalized[trackId];
    const rotated = Array.from({ length: context.length }, () => createDefaultStep());
    source.forEach((step, index) => {
      rotated[(index + offset) % context.length] = step;
    });
    replaceTrack(context.normalized, trackId, rotated);
  }
  return context.normalized;
}

export function reversePattern(pattern, options = {}) {
  const context = transformContext(pattern, options);
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (shouldTransform(trackId, context)) {
      replaceTrack(context.normalized, trackId, context.normalized[trackId].slice().reverse());
    }
  }
  return context.normalized;
}

export function mirrorPattern(pattern, options = {}) {
  const context = transformContext(pattern, options);
  const midpoint = Math.ceil(context.length / 2);
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (!shouldTransform(trackId, context)) continue;
    const source = context.normalized[trackId];
    const mirrored = source.map((step, index) => (
      index < midpoint ? step : source[context.length - 1 - index]
    ));
    replaceTrack(context.normalized, trackId, mirrored);
  }
  return context.normalized;
}

/** Double-time keeps the sequence length and plays its first half twice. */
export function doublePattern(pattern, options = {}) {
  const context = transformContext(pattern, options);
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (!shouldTransform(trackId, context)) continue;
    const source = context.normalized[trackId];
    replaceTrack(
      context.normalized,
      trackId,
      Array.from({ length: context.length }, (_, index) => source[(index * 2) % context.length]),
    );
  }
  return context.normalized;
}

/** Half-time keeps the sequence length and spreads its first half over the grid. */
export function halvePattern(pattern, options = {}) {
  const context = transformContext(pattern, options);
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (!shouldTransform(trackId, context)) continue;
    const source = context.normalized[trackId];
    const halved = Array.from({ length: context.length }, () => createDefaultStep());
    for (let index = 0; index < Math.ceil(context.length / 2); index += 1) {
      halved[index * 2] = source[index];
    }
    replaceTrack(context.normalized, trackId, halved);
  }
  return context.normalized;
}

export function sparsePattern(pattern, options = {}) {
  const context = transformContext(pattern, options);
  const amount = normalizeUnit(options.amount, 0.25);
  const random = createSeededRandom(normalizedSeed(options.seed, 'sparse'));
  const candidates = [];
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (!shouldTransform(trackId, context)) continue;
    context.normalized[trackId].forEach((step, index) => {
      if (step.active && !step.accent) candidates.push([trackId, index]);
    });
  }

  const removalCount = Math.min(candidates.length, Math.ceil(candidates.length * amount));
  shuffled(candidates, random).slice(0, removalCount).forEach(([trackId, index]) => {
    context.normalized[trackId][index] = createDefaultStep();
  });
  return context.normalized;
}

export function densePattern(pattern, options = {}) {
  const context = transformContext(pattern, options);
  const amount = normalizeUnit(options.amount, 0.15);
  const seed = normalizedSeed(options.seed, 'dense');
  const random = createSeededRandom(seed);
  const candidates = [];
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (!shouldTransform(trackId, context)) continue;
    context.normalized[trackId].forEach((step, index) => {
      if (!step.active) candidates.push([trackId, index]);
    });
  }

  const additionCount = Math.min(candidates.length, Math.ceil(candidates.length * amount));
  shuffled(candidates, random).slice(0, additionCount).forEach(([trackId, index]) => {
    const expression = createSeededRandom(`${seed}:${trackId}:${index}`);
    context.normalized[trackId][index] = normalizeStep({
      active: true,
      velocity: 0.65 + (expression() * 0.3),
      probability: 0.8 + (expression() * 0.2),
      nudgeMs: Math.round((expression() - 0.5) * 16),
    });
  });
  return context.normalized;
}

export function fillPattern(pattern, options = {}) {
  const defaultTracks = ['snare', 'tom', 'perc1', 'perc2', 'crash'];
  const context = transformContext(pattern, options, defaultTracks);
  const fillSteps = Math.max(1, Math.min(context.length, Math.trunc(Number(options.steps ?? 4)) || 4));
  const start = context.length - fillSteps;
  const tracks = [...context.selectedTracks];

  for (let index = start; index < context.length; index += 1) {
    const trackId = tracks[(index - start) % tracks.length];
    if (!trackId || context.locks[trackId]) continue;
    context.normalized[trackId][index] = normalizeStep({
      active: true,
      velocity: index === context.length - 1 ? 1 : 0.78,
      accent: index === context.length - 1,
      ratchet: index === context.length - 1 ? 2 : 1,
    });
  }
  return context.normalized;
}

export function createEuclideanRhythm(steps, pulses, rotation = 0) {
  const safeSteps = assertLength(Number(steps));
  const safePulses = clamp(Math.trunc(Number(pulses) || 0), 0, safeSteps);
  const rhythm = Array.from({ length: safeSteps }, (_, index) => (
    Math.floor(((index + 1) * safePulses) / safeSteps) !== Math.floor((index * safePulses) / safeSteps)
  ));
  const offset = ((Math.trunc(Number(rotation) || 0) % safeSteps) + safeSteps) % safeSteps;
  return Array.from({ length: safeSteps }, (_, index) => rhythm[(index - offset + safeSteps) % safeSteps]);
}

export function euclideanPattern(pattern, options = {}) {
  const context = transformContext(pattern, options, ['perc1']);
  const pulses = options.pulses ?? Math.max(1, Math.round(context.length / 4));
  const rhythm = createEuclideanRhythm(context.length, pulses, options.rotation);
  for (const trackId of GENERATED_DRUM_TRACK_IDS) {
    if (!shouldTransform(trackId, context)) continue;
    const source = context.normalized[trackId];
    replaceTrack(context.normalized, trackId, rhythm.map((active, index) => (
      active ? normalizeStep({ ...source[index], active: true }) : createDefaultStep()
    )));
  }
  return context.normalized;
}

export function applyPatternTransform(pattern, transform, options = {}) {
  if (!PATTERN_TRANSFORMS.includes(transform)) {
    throw new RangeError(`Unsupported transform. Expected one of: ${PATTERN_TRANSFORMS.join(', ')}`);
  }

  switch (transform) {
    case 'rotate': return rotatePattern(pattern, options.amount ?? 1, options);
    case 'reverse': return reversePattern(pattern, options);
    case 'mirror': return mirrorPattern(pattern, options);
    case 'double': return doublePattern(pattern, options);
    case 'halve': return halvePattern(pattern, options);
    case 'sparse': return sparsePattern(pattern, options);
    case 'dense': return densePattern(pattern, options);
    case 'fill': return fillPattern(pattern, options);
    case 'euclidean': return euclideanPattern(pattern, options);
    default: throw new RangeError(`Unsupported transform: ${transform}`);
  }
}

export const transformPattern = applyPatternTransform;

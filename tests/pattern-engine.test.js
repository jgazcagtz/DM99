import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERATED_DRUM_TRACK_IDS,
  PATTERN_LIMITS,
  PATTERN_VARIATIONS,
  SUPPORTED_GENRES,
} from '../src/pattern-constants.js';
import {
  applyPatternTransform,
  countPatternHits,
  createEmptyPattern,
  createEuclideanRhythm,
  densePattern,
  doublePattern,
  euclideanPattern,
  fillPattern,
  generatePattern,
  generatePatternVariations,
  halvePattern,
  mirrorPattern,
  reversePattern,
  rotatePattern,
  sparsePattern,
  toBooleanPattern,
} from '../src/pattern-engine.js';

function activeIndexes(track) {
  return track.flatMap((step, index) => (step.active ? [index] : []));
}

test('expressive generation is bounded, canonical, and browser-safe data', () => {
  for (const genre of SUPPORTED_GENRES) {
    const result = generatePattern({
      genre,
      bpm: 128,
      length: 32,
      energy: 1,
      seed: 'expressive',
      variation: 'c',
      complexity: 1,
      syncopation: 1,
      humanize: 1,
    });
    assert.deepEqual(Object.keys(result.pattern), GENERATED_DRUM_TRACK_IDS);
    for (const track of Object.values(result.pattern)) {
      assert.equal(track.length, 32);
      for (const step of track) {
        assert.equal(typeof step.active, 'boolean');
        assert.ok(Number.isInteger(step.pitch));
        assert.ok(step.pitch >= PATTERN_LIMITS.minPitch && step.pitch <= PATTERN_LIMITS.maxPitch);
        assert.ok(step.velocity >= 0 && step.velocity <= 1);
        assert.ok(step.probability >= 0 && step.probability <= 1);
        assert.ok(Number.isInteger(step.ratchet));
        assert.ok(step.ratchet >= 1 && step.ratchet <= 8);
        assert.ok(Number.isInteger(step.nudgeMs));
        assert.ok(step.nudgeMs >= -100 && step.nudgeMs <= 100);
        assert.equal(typeof step.accent, 'boolean');
        assert.equal(typeof step.slide, 'boolean');
      }
    }
  }
});

test('seed and each of the three variations are deterministic and meaningful', () => {
  assert.deepEqual(PATTERN_VARIATIONS, ['a', 'b', 'c']);
  const options = { genre: 'electro', bpm: 118, length: 32, energy: 0.8, seed: 'seed-one' };
  const first = generatePattern(options);
  assert.deepEqual(first, generatePattern(options));
  assert.notDeepEqual(first.pattern, generatePattern({ ...options, seed: 'seed-two' }).pattern);

  const signatures = PATTERN_VARIATIONS.map((variation) => (
    JSON.stringify(toBooleanPattern(generatePattern({ ...options, variation }).pattern))
  ));
  assert.equal(new Set(signatures).size, 3);
  assert.deepEqual(
    generatePatternVariations(options).map((result) => result.variation),
    PATTERN_VARIATIONS,
  );
});

test('each genre retains its defining foundation at minimum energy', () => {
  const expectedHits = {
    techno: [['kick', 4]],
    house: [['clap', 4], ['hihatClosed', 2]],
    trance: [['kick', 8], ['snare', 12]],
    dnb: [['kick', 6], ['snare', 4]],
    electro: [['kick', 7], ['clap', 12]],
    industrial: [['kick', 3], ['tom', 10]],
    acid: [['perc1', 3], ['clap', 4]],
    ambient: [['kick', 0], ['ride', 8]],
  };
  for (const [genre, hits] of Object.entries(expectedHits)) {
    const { pattern } = generatePattern({ genre, length: 32, energy: 0, seed: 'foundation' });
    for (const [trackId, step] of hits) assert.equal(pattern[trackId][step].active, true);
  }
});

test('complexity, syncopation, and humanize have deterministic bounded effects', () => {
  const base = { genre: 'techno', bpm: 132, length: 32, energy: 0.9, seed: 'controls', variation: 'a' };
  const simple = generatePattern({ ...base, complexity: 0, syncopation: 0, humanize: 0 });
  const complex = generatePattern({ ...base, complexity: 1, syncopation: 0, humanize: 0 });
  assert.ok(complex.hitCount > simple.hitCount);
  const simpleRatchets = Object.values(simple.pattern).flat().reduce((sum, step) => sum + step.ratchet, 0);
  const complexRatchets = Object.values(complex.pattern).flat().reduce((sum, step) => sum + step.ratchet, 0);
  assert.ok(complexRatchets > simpleRatchets);

  const straight = generatePattern({ ...base, complexity: 1, syncopation: 0, humanize: 0 });
  const syncopated = generatePattern({ ...base, complexity: 1, syncopation: 1, humanize: 0 });
  const offGridHits = (result) => Object.values(result.pattern).reduce(
    (sum, track) => sum + track.filter((step, index) => step.active && index % 4 !== 0).length,
    0,
  );
  assert.ok(offGridHits(syncopated) > offGridHits(straight));

  const human = generatePattern({ ...base, complexity: 0.5, syncopation: 0.5, humanize: 1 });
  assert.ok(Object.values(simple.pattern).flat().every((step) => !step.active || step.nudgeMs === 0));
  assert.ok(Object.values(human.pattern).flat().some((step) => step.active && step.nudgeMs !== 0));
  assert.deepEqual(human, generatePattern({ ...base, complexity: 0.5, syncopation: 0.5, humanize: 1 }));
});

test('generation locks preserve normalized current tracks without mutating the input', () => {
  const current = createEmptyPattern(32);
  current.kick[1] = { ...current.kick[1], active: true, velocity: 0.4, nudgeMs: -12 };
  const snapshot = structuredClone(current);
  const generated = generatePattern({
    genre: 'industrial', length: 32, energy: 1, seed: 'locked',
    locks: { kick: true }, currentPattern: current,
  });
  assert.deepEqual(current, snapshot);
  assert.deepEqual(generated.pattern.kick, current.kick);
  assert.deepEqual(generated.lockedTracks, ['kick']);
  assert.ok(generated.pattern.snare.some((step) => step.active));
});

test('positional transforms return fresh patterns with defined timing semantics', () => {
  const source = createEmptyPattern(32);
  source.kick[0].active = true;
  source.kick[4].active = true;
  const snapshot = structuredClone(source);

  assert.deepEqual(activeIndexes(rotatePattern(source, 2).kick), [2, 6]);
  assert.deepEqual(activeIndexes(reversePattern(source).kick), [27, 31]);
  assert.deepEqual(activeIndexes(mirrorPattern(source).kick), [0, 4, 27, 31]);
  assert.deepEqual(activeIndexes(doublePattern(source).kick), [0, 2, 16, 18]);
  assert.deepEqual(activeIndexes(halvePattern(source).kick), [0, 8]);
  assert.deepEqual(source, snapshot);
});

test('density, fill, and Euclidean transforms are deterministic, lock-aware, and non-mutating', () => {
  const source = createEmptyPattern(32);
  source.kick[0].active = true;
  source.snare[4].active = true;
  const snapshot = structuredClone(source);

  const dense = densePattern(source, { amount: 0.1, seed: 'dense' });
  const sparse = sparsePattern(dense, { amount: 0.5, seed: 'sparse' });
  assert.ok(countPatternHits(dense) > countPatternHits(source));
  assert.ok(countPatternHits(sparse) < countPatternHits(dense));
  assert.deepEqual(dense, densePattern(source, { amount: 0.1, seed: 'dense' }));

  const fill = fillPattern(source);
  assert.ok(countPatternHits(fill) > countPatternHits(source));
  const euclidean = euclideanPattern(source, { trackIds: ['perc1'], pulses: 7, rotation: 2 });
  assert.equal(activeIndexes(euclidean.perc1).length, 7);
  assert.equal(createEuclideanRhythm(32, 7, 2).filter(Boolean).length, 7);

  const locked = applyPatternTransform(source, 'dense', {
    amount: 1, seed: 'locked-transform', locks: { kick: true },
  });
  assert.deepEqual(locked.kick, source.kick);
  assert.deepEqual(source, snapshot);
});

test('transform dispatcher covers every transform and rejects unknown operations', () => {
  const source = createEmptyPattern(32);
  source.perc1[0].active = true;
  for (const transform of ['rotate', 'reverse', 'mirror', 'double', 'halve', 'sparse', 'dense', 'fill', 'euclidean']) {
    const transformed = applyPatternTransform(source, transform, {
      amount: 1, pulses: 5, seed: transform,
    });
    assert.deepEqual(Object.keys(transformed), GENERATED_DRUM_TRACK_IDS);
  }
  assert.throws(() => applyPatternTransform(source, 'randomize'), RangeError);
});

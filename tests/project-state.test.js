import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INSTRUMENT_IDS,
  PATTERN_SLOT_IDS,
  PROJECT_STATE_VERSION,
} from '../src/pattern-constants.js';
import {
  createDefaultProjectState,
  migrateProjectState,
  migrateProjectV2ToV3,
  normalizeProjectState,
  normalizeStep,
} from '../src/project-state.js';

const STEP_KEYS = [
  'active', 'pitch', 'scale', 'velocity', 'probability',
  'ratchet', 'nudgeMs', 'accent', 'slide',
];

test('v2 projects migrate to a complete bounded v3 project without input mutation', () => {
  const kick = Array.from({ length: 32 }, (_, index) => ({
    active: index === 0,
    pitch: index === 0 ? 99 : 0,
    scale: 'phrygian',
  }));
  const legacy = {
    version: 2,
    sequences: { kick },
    tempo: 999,
    swing: -20,
    volumes: { kick: 5 },
    muted: { kick: true },
    adsr: { kick: { attack: -1, decay: 9, sustain: 2, release: 9 } },
  };
  const snapshot = structuredClone(legacy);
  const migrated = migrateProjectV2ToV3(legacy);

  assert.deepEqual(legacy, snapshot);
  assert.equal(migrated.version, PROJECT_STATE_VERSION);
  assert.equal(migrated.sequenceLength, 32);
  assert.deepEqual(Object.keys(migrated.sequences), INSTRUMENT_IDS);
  assert.deepEqual(Object.keys(migrated.patterns), PATTERN_SLOT_IDS);
  assert.equal(migrated.activePattern, 'A');
  assert.equal(migrated.patterns.A.kick[0].active, true);
  assert.equal(migrated.patterns.B.kick[0].active, false);
  assert.deepEqual(Object.keys(migrated.sequences.kick[0]), STEP_KEYS);
  assert.equal(migrated.sequences.kick[0].pitch, 48);
  assert.equal(migrated.tempo, 240);
  assert.equal(migrated.swing, 0);
  assert.equal(migrated.volumes.kick, 1);
  assert.equal(migrated.muted.kick, true);
  assert.deepEqual(migrated.adsr.kick, { attack: 0, decay: 2, sustain: 1, release: 2 });
  assert.deepEqual(Object.keys(migrated.locks), INSTRUMENT_IDS);
});

test('v3 normalization preserves pattern slots and bounds project, track, effect, and generator fields', () => {
  const source = {
    version: 3,
    projectName: `\u0000  ${'P'.repeat(100)}  `,
    kitId: 'warehouse-kit',
    sequenceLength: 16,
    activePattern: 'c',
    patterns: {
      C: { kick: [{ active: true, velocity: 4, probability: -1, ratchet: 99, nudgeMs: -999 }] },
    },
    trackSettings: {
      kick: {
        presetId: 'heavy-kick',
        pan: 9,
        chokeGroup: 'drums',
        sample: {
          name: 'Kick 01',
          url: 'https://example.test/kick.wav',
          source: 'custom',
          mimeType: 'audio/wav',
          license: 'user supplied',
          attribution: 'Producer',
          id: 'kick-upload-01',
          start: 0.9,
          end: 0.1,
          tune: 99,
          mode: 'loop',
        },
      },
      snare: {
        presetId: '<unsafe>',
        chokeGroup: 'not safe',
        sample: { id: '../sample', mode: 'invalid' },
      },
    },
    effects: {
      masterVolume: 4,
      drive: 2,
      delayWet: -1,
      reverbWet: 0.4,
      lowpassHz: 99_999,
      highpassHz: -5,
      masterEq: { low: -99, mid: 3, high: 99 },
      bassEq: { low: -4, mid: 2, high: 6 },
    },
    generator: {
      genre: 'ambient', seed: 'fog', variation: 2, energy: 2,
      complexity: -1, syncopation: 3, humanize: 0.25,
    },
  };
  const snapshot = structuredClone(source);
  const project = normalizeProjectState(source);

  assert.deepEqual(source, snapshot);
  assert.equal(project.projectName.length, 80);
  assert.equal(project.kitId, 'warehouse-kit');
  assert.equal(project.activePattern, 'C');
  assert.equal(project.sequences.kick[0].active, true);
  assert.equal(project.sequences.kick[0].velocity, 1);
  assert.equal(project.sequences.kick[0].probability, 0);
  assert.equal(project.sequences.kick[0].ratchet, 8);
  assert.equal(project.sequences.kick[0].nudgeMs, -100);
  assert.equal(project.trackSettings.kick.pan, 1);
  assert.equal(project.trackSettings.kick.sample.source, 'custom');
  assert.equal(project.trackSettings.kick.sample.url, 'https://example.test/kick.wav');
  assert.equal(project.trackSettings.kick.sample.id, 'kick-upload-01');
  assert.equal(project.trackSettings.kick.sample.start, 0.1);
  assert.equal(project.trackSettings.kick.sample.end, 0.9);
  assert.equal(project.trackSettings.kick.sample.tune, 24);
  assert.equal(project.trackSettings.kick.sample.mode, 'loop');
  assert.equal(project.trackSettings.snare.presetId, 'snare-tight');
  assert.equal(project.trackSettings.snare.chokeGroup, '');
  assert.equal(project.trackSettings.snare.sample.id, '');
  assert.equal(project.trackSettings.snare.sample.mode, 'one-shot');
  assert.deepEqual(project.effects.masterEq, { low: -12, mid: 3, high: 12 });
  assert.equal(project.effects.masterVolume, 1);
  assert.equal(project.effects.drive, 1);
  assert.equal(project.effects.delayWet, 0);
  assert.equal(project.effects.reverbWet, 0.4);
  assert.equal(project.effects.lowpassHz, 20_000);
  assert.equal(project.effects.highpassHz, 20);
  assert.deepEqual(project.generator, {
    genre: 'ambient',
    energy: 1,
    seed: 'fog',
    variation: 'b',
    complexity: 0,
    syncopation: 1,
    humanize: 0.25,
  });
});

test('step normalization enforces every expressive-field bound', () => {
  assert.deepEqual(normalizeStep({
    active: 'true', pitch: -999, scale: 'unknown', velocity: -1,
    probability: 2, ratchet: 0, nudgeMs: 999, accent: 1, slide: 'false',
  }), {
    active: true,
    pitch: -48,
    scale: 'minor',
    velocity: 0,
    probability: 1,
    ratchet: 1,
    nudgeMs: 100,
    accent: true,
    slide: false,
  });
});

test('default and generic migration produce independent complete projects', () => {
  const first = createDefaultProjectState();
  const second = migrateProjectState(null);
  first.patterns.A.kick[0].active = true;
  assert.equal(second.patterns.A.kick[0].active, false);
  assert.equal(first.projectName, 'Untitled Project');
  assert.equal(first.kitId, 'techno');
  assert.equal(Object.keys(first.trackSettings).length, INSTRUMENT_IDS.length);
  assert.equal(Object.keys(first.patterns).length, 8);
  assert.deepEqual(first.trackSettings.kick.sample, {
    id: '',
    name: '',
    url: '',
    source: 'procedural',
    mimeType: '',
    license: '',
    attribution: '',
    start: 0,
    end: 1,
    tune: 0,
    mode: 'one-shot',
  });
  assert.equal(first.trackSettings.kick.presetId, 'kick-tight');
  assert.equal(first.trackSettings.sub.presetId, 'sub-techno');
  assert.equal(first.trackSettings.sub.sample.source, 'procedural');
  assert.equal(first.effects.drive, 0);
  assert.equal(first.effects.masterVolume, 0.82);
  assert.equal(first.effects.delayWet, 0.12);
  assert.equal(first.effects.reverbWet, 0.08);
  assert.equal(first.generator.complexity, 0.55);
  assert.equal(first.generator.syncopation, 0.35);
  assert.equal(first.generator.humanize, 0.12);
});

test('future project versions fail closed', () => {
  assert.throws(() => normalizeProjectState({ version: 4 }), RangeError);
  assert.throws(() => normalizeProjectState({ version: 2.5 }), RangeError);
  assert.throws(() => migrateProjectV2ToV3({ version: 1 }), TypeError);
});

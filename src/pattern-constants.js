export const PROJECT_STATE_VERSION = 3;

export const DEFAULT_SEQUENCE_LENGTH = 32;

export const GENERATED_DRUM_TRACK_IDS = Object.freeze([
  'kick',
  'snare',
  'hihatClosed',
  'hihatOpened',
  'clap',
  'tom',
  'perc1',
  'perc2',
  'perc3',
  'crash',
  'ride',
]);

export const SAMPLE_INSTRUMENT_IDS = Object.freeze([
  'kick',
  'snare',
  'clap',
  'tom',
  'rimshot',
  'cowbell',
  'hihatClosed',
  'hihatOpened',
  'crash',
  'ride',
  'perc1',
  'perc2',
  'perc3',
  'perc4',
  'perc5',
  'perc6',
  'shaker',
  'tamb',
  'bass1',
  'acid',
  'synth',
]);

export const SYNTH_INSTRUMENT_IDS = Object.freeze([
  'sub',
  'tr808',
  'fmBass',
  'pluck',
  'amPad',
]);

// Compatibility alias for the five tracks that were historically Tone.js-backed.
export const TONE_INSTRUMENT_IDS = SYNTH_INSTRUMENT_IDS;

export const INSTRUMENT_IDS = Object.freeze([
  ...SAMPLE_INSTRUMENT_IDS,
  ...SYNTH_INSTRUMENT_IDS,
]);

export const DEFAULT_KIT_ID = 'techno';

export const DEFAULT_PRESET_IDS = Object.freeze(Object.fromEntries(
  INSTRUMENT_IDS.map((instrumentId) => [
    instrumentId,
    SAMPLE_INSTRUMENT_IDS.includes(instrumentId)
      ? `${instrumentId}-tight`
      : `${instrumentId}-techno`,
  ]),
));

export const SUPPORTED_GENRES = Object.freeze([
  'techno',
  'house',
  'trance',
  'dnb',
  'electro',
  'industrial',
  'acid',
  'ambient',
]);

export const PATTERN_VARIATIONS = Object.freeze(['a', 'b', 'c']);

export const PATTERN_SLOT_IDS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);

export const PATTERN_TRANSFORMS = Object.freeze([
  'rotate',
  'reverse',
  'mirror',
  'double',
  'halve',
  'sparse',
  'dense',
  'fill',
  'euclidean',
]);

export const SCALE_IDS = Object.freeze([
  'minor',
  'phrygian',
  'major',
  'dorian',
  'mixolydian',
  'chromatic',
]);

export const PATTERN_LIMITS = Object.freeze({
  minBpm: 40,
  maxBpm: 240,
  minEnergy: 0,
  maxEnergy: 1,
  minLength: 8,
  maxLength: 64,
  maxSeedLength: 64,
  maxProjectNameLength: 80,
  maxIdentifierLength: 64,
  maxMetadataTextLength: 256,
  maxSampleUrlLength: 2_048,
  maxBodyBytes: 4_096,
  minPitch: -48,
  maxPitch: 48,
  minVelocity: 0,
  maxVelocity: 1,
  minProbability: 0,
  maxProbability: 1,
  minRatchet: 1,
  maxRatchet: 8,
  minNudgeMs: -100,
  maxNudgeMs: 100,
  minSwing: 0,
  maxSwing: 100,
  minPan: -1,
  maxPan: 1,
  minEqDb: -12,
  maxEqDb: 12,
  minTune: -24,
  maxTune: 24,
  minLowpassHz: 200,
  maxLowpassHz: 20_000,
  minHighpassHz: 20,
  maxHighpassHz: 2_000,
});

export const DEFAULT_STEP = Object.freeze({
  active: false,
  pitch: 0,
  scale: 'minor',
  velocity: 1,
  probability: 1,
  ratchet: 1,
  nudgeMs: 0,
  accent: false,
  slide: false,
});

export const DEFAULT_GENERATOR_SETTINGS = Object.freeze({
  genre: 'techno',
  energy: 0.7,
  seed: 'dm99',
  variation: 'a',
  complexity: 0.55,
  syncopation: 0.35,
  humanize: 0.12,
});

export const DEFAULT_EFFECTS = Object.freeze({
  masterVolume: 0.82,
  drive: 0,
  delayWet: 0.12,
  reverbWet: 0.08,
  lowpassHz: 20_000,
  highpassHz: 20,
  masterEq: Object.freeze({ low: 0, mid: 0, high: 0 }),
  bassEq: Object.freeze({ low: 0, mid: 0, high: 0 }),
});

export const DEFAULT_INSTRUMENT_VOLUMES = Object.freeze({
  kick: 0.8,
  snare: 0.7,
  clap: 0.7,
  tom: 0.7,
  rimshot: 0.65,
  cowbell: 0.55,
  hihatClosed: 0.6,
  hihatOpened: 0.6,
  crash: 0.45,
  ride: 0.45,
  perc1: 0.6,
  perc2: 0.6,
  perc3: 0.6,
  perc4: 0.6,
  perc5: 0.6,
  perc6: 0.6,
  shaker: 0.5,
  tamb: 0.5,
  bass1: 0.5,
  acid: 0.6,
  synth: 0.6,
  sub: 0.6,
  tr808: 0.6,
  fmBass: 0.5,
  pluck: 0.5,
  amPad: 0.5,
});

export const DEFAULT_ADSR = Object.freeze({
  kick: Object.freeze({ attack: 0.01, decay: 0.3, sustain: 0, release: 0.2 }),
  hihatClosed: Object.freeze({ attack: 0.005, decay: 0.15, sustain: 0, release: 0.1 }),
  bass1: Object.freeze({ attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 }),
  acid: Object.freeze({ attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2 }),
  synth: Object.freeze({ attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.5 }),
  sub: Object.freeze({ attack: 0.01, decay: 0.5, sustain: 0.8, release: 0.3 }),
  tr808: Object.freeze({ attack: 0.001, decay: 0.8, sustain: 0, release: 0.1 }),
  fmBass: Object.freeze({ attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 }),
  amPad: Object.freeze({ attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 }),
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
  ['electro', 'electro'],
  ['industrial', 'industrial'],
  ['acid', 'acid'],
  ['ambient', 'ambient'],
]);

export function normalizeGenreId(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return GENRE_ALIASES.get(key) || null;
}

export function normalizeVariationId(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return PATTERN_VARIATIONS[value - 1] || null;
  }

  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (PATTERN_VARIATIONS.includes(key)) return key;
  if (/^[123]$/.test(key)) return PATTERN_VARIATIONS[Number(key) - 1];
  return null;
}

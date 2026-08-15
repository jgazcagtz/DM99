/**
 * DM99's dependency-free instrument and preset registry.
 *
 * Every sound described here is synthesized with the Web Audio API. The
 * registry is deliberately data-only so it can be validated in Node, cached,
 * serialized, or consumed by a future UI without creating an AudioContext.
 */

/** Stable track order used by the existing 32-step sequencer. */
export const TRACK_IDS = Object.freeze([
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
  'sub',
  'tr808',
  'fmBass',
  'pluck',
  'amPad',
]);

/** Tracks with four compact procedural variations each. */
export const SAMPLE_STYLE_TRACK_IDS = Object.freeze(TRACK_IDS.slice(0, 21));

/** Tracks with one purpose-built variation for every kit snapshot. */
export const SYNTH_TRACK_IDS = Object.freeze(TRACK_IDS.slice(21));

/** Human-facing snapshot names, kept in their intended display order. */
export const KIT_NAMES = Object.freeze([
  'Techno',
  'Deep House',
  'Electro',
  'Trance',
  'DnB',
  'Industrial',
  'Acid',
  'Ambient',
]);

const PROVENANCE = 'DM99-generated';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function round(value, digits = 5) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableSeed(text) {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const SAMPLE_TRACK_BLUEPRINTS = [
  {
    id: 'kick', label: 'Kick', group: 'Drums', voice: 'kick', defaultGain: 0.8,
    tags: ['drum', 'low', 'transient'],
    base: { oscillator: 'sine', frequency: 52, attack: 0.002, decay: 0.43, sustain: 0, release: 0.06, pitchSweep: 3.1, filterFrequency: 1900, filterQ: 0.7, noise: 0.07, click: 0.3, drive: 0.1 },
  },
  {
    id: 'snare', label: 'Snare', group: 'Drums', voice: 'snare', defaultGain: 0.7,
    tags: ['drum', 'noise', 'backbeat'],
    base: { oscillator: 'triangle', frequency: 184, attack: 0.002, decay: 0.24, sustain: 0, release: 0.09, pitchSweep: 1.12, filterFrequency: 3900, filterQ: 0.9, noise: 0.74, click: 0.21, drive: 0.07 },
  },
  {
    id: 'clap', label: 'Clap', group: 'Drums', voice: 'clap', defaultGain: 0.7,
    tags: ['drum', 'noise', 'burst'],
    base: { oscillator: 'square', frequency: 860, attack: 0.001, decay: 0.2, sustain: 0, release: 0.13, pitchSweep: 1, filterFrequency: 1650, filterQ: 0.65, noise: 0.9, click: 0.12, drive: 0.05, burstCount: 3, burstSpacing: 0.021 },
  },
  {
    id: 'tom', label: 'Tom', group: 'Drums', voice: 'tom', defaultGain: 0.7,
    tags: ['drum', 'pitched', 'body'],
    base: { oscillator: 'sine', frequency: 118, attack: 0.003, decay: 0.48, sustain: 0, release: 0.12, pitchSweep: 1.62, filterFrequency: 2100, filterQ: 0.95, noise: 0.08, click: 0.11, drive: 0.06 },
  },
  {
    id: 'rimshot', label: 'Rim', group: 'Drums', voice: 'rim', defaultGain: 0.65,
    tags: ['drum', 'metallic', 'short'],
    base: { oscillator: 'triangle', frequency: 640, attack: 0.001, decay: 0.105, sustain: 0, release: 0.035, pitchSweep: 1.08, filterFrequency: 5200, filterQ: 2.8, noise: 0.16, click: 0.54, drive: 0.09, harmonicity: 1.47 },
  },
  {
    id: 'cowbell', label: 'Cow', group: 'Drums', voice: 'metal', defaultGain: 0.55,
    tags: ['drum', 'metallic', 'pitched'],
    base: { oscillator: 'square', frequency: 548, attack: 0.002, decay: 0.34, sustain: 0, release: 0.09, pitchSweep: 1.02, filterFrequency: 4300, filterQ: 1.3, noise: 0.03, click: 0.08, drive: 0.08, harmonicity: 1.56 },
  },
  {
    id: 'hihatClosed', label: 'HHC', group: 'Cymbals', voice: 'hat', defaultGain: 0.6,
    tags: ['cymbal', 'noise', 'short'],
    base: { oscillator: 'square', frequency: 6120, attack: 0.001, decay: 0.085, sustain: 0, release: 0.025, pitchSweep: 1, filterFrequency: 7200, filterQ: 0.75, noise: 0.72, click: 0.08, drive: 0.04, harmonicity: 1.43 },
  },
  {
    id: 'hihatOpened', label: 'HHO', group: 'Cymbals', voice: 'hat', defaultGain: 0.6,
    tags: ['cymbal', 'noise', 'open'],
    base: { oscillator: 'square', frequency: 5840, attack: 0.001, decay: 0.48, sustain: 0.035, release: 0.24, pitchSweep: 1, filterFrequency: 6800, filterQ: 0.68, noise: 0.78, click: 0.06, drive: 0.04, harmonicity: 1.39 },
  },
  {
    id: 'crash', label: 'Crash', group: 'Cymbals', voice: 'cymbal', defaultGain: 0.45,
    tags: ['cymbal', 'noise', 'long'],
    base: { oscillator: 'sawtooth', frequency: 3980, attack: 0.002, decay: 1.18, sustain: 0.025, release: 0.42, pitchSweep: 1.02, filterFrequency: 5100, filterQ: 0.55, noise: 0.68, click: 0.04, drive: 0.035, harmonicity: 1.61 },
  },
  {
    id: 'ride', label: 'Ride', group: 'Cymbals', voice: 'cymbal', defaultGain: 0.45,
    tags: ['cymbal', 'metallic', 'sustain'],
    base: { oscillator: 'triangle', frequency: 2910, attack: 0.002, decay: 0.82, sustain: 0.045, release: 0.36, pitchSweep: 1.01, filterFrequency: 4250, filterQ: 1.1, noise: 0.43, click: 0.18, drive: 0.045, harmonicity: 1.72 },
  },
  {
    id: 'perc1', label: 'Perc1', group: 'Perc', voice: 'shaker', defaultGain: 0.6,
    tags: ['percussion', 'noise', 'shaker'],
    base: { oscillator: 'square', frequency: 4100, attack: 0.001, decay: 0.13, sustain: 0, release: 0.05, pitchSweep: 1, filterFrequency: 6100, filterQ: 0.8, noise: 0.83, click: 0.04, drive: 0.03 },
  },
  {
    id: 'perc2', label: 'Perc2', group: 'Perc', voice: 'metal', defaultGain: 0.6,
    tags: ['percussion', 'metallic', 'pitched'],
    base: { oscillator: 'square', frequency: 720, attack: 0.002, decay: 0.2, sustain: 0, release: 0.07, pitchSweep: 1.06, filterFrequency: 3900, filterQ: 1.8, noise: 0.08, click: 0.2, drive: 0.06, harmonicity: 1.32 },
  },
  {
    id: 'perc3', label: 'Perc3', group: 'Perc', voice: 'cymbal', defaultGain: 0.6,
    tags: ['percussion', 'metallic', 'bright'],
    base: { oscillator: 'triangle', frequency: 2390, attack: 0.001, decay: 0.42, sustain: 0.01, release: 0.14, pitchSweep: 1.03, filterFrequency: 4800, filterQ: 1.05, noise: 0.35, click: 0.09, drive: 0.04, harmonicity: 1.81 },
  },
  {
    id: 'perc4', label: 'Perc4', group: 'Perc', voice: 'tom', defaultGain: 0.6,
    tags: ['percussion', 'pitched', 'low'],
    base: { oscillator: 'triangle', frequency: 156, attack: 0.002, decay: 0.3, sustain: 0, release: 0.1, pitchSweep: 1.33, filterFrequency: 2700, filterQ: 1.1, noise: 0.06, click: 0.12, drive: 0.05 },
  },
  {
    id: 'perc5', label: 'Perc5', group: 'Perc', voice: 'metal', defaultGain: 0.6,
    tags: ['percussion', 'metallic', 'mid'],
    base: { oscillator: 'square', frequency: 910, attack: 0.001, decay: 0.17, sustain: 0, release: 0.06, pitchSweep: 1.04, filterFrequency: 4550, filterQ: 2.05, noise: 0.1, click: 0.22, drive: 0.07, harmonicity: 1.24 },
  },
  {
    id: 'perc6', label: 'Perc6', group: 'Perc', voice: 'tom', defaultGain: 0.6,
    tags: ['percussion', 'pitched', 'high'],
    base: { oscillator: 'sine', frequency: 264, attack: 0.002, decay: 0.21, sustain: 0, release: 0.065, pitchSweep: 1.26, filterFrequency: 3400, filterQ: 1.2, noise: 0.045, click: 0.14, drive: 0.04 },
  },
  {
    id: 'shaker', label: 'Shak', group: 'Perc', voice: 'shaker', defaultGain: 0.5,
    tags: ['percussion', 'noise', 'shaker'],
    base: { oscillator: 'square', frequency: 4780, attack: 0.001, decay: 0.16, sustain: 0, release: 0.055, pitchSweep: 1, filterFrequency: 6550, filterQ: 0.7, noise: 0.92, click: 0.025, drive: 0.025 },
  },
  {
    id: 'tamb', label: 'Tamb', group: 'Perc', voice: 'cymbal', defaultGain: 0.5,
    tags: ['percussion', 'metallic', 'tambourine'],
    base: { oscillator: 'square', frequency: 3520, attack: 0.001, decay: 0.31, sustain: 0.012, release: 0.13, pitchSweep: 1.01, filterFrequency: 5900, filterQ: 0.82, noise: 0.55, click: 0.1, drive: 0.035, harmonicity: 1.52 },
  },
  {
    id: 'bass1', label: 'Bass', group: 'Tonal', voice: 'bass', defaultGain: 0.5,
    tags: ['tonal', 'bass', 'mono'],
    base: { oscillator: 'sawtooth', frequency: 55, attack: 0.008, decay: 0.24, sustain: 0.56, release: 0.22, pitchSweep: 1, filterFrequency: 780, filterQ: 1.4, noise: 0.01, click: 0.03, drive: 0.12, detune: 0 },
  },
  {
    id: 'acid', label: 'Acid', group: 'Tonal', voice: 'acid', defaultGain: 0.6,
    tags: ['tonal', 'acid', 'resonant'],
    base: { oscillator: 'sawtooth', frequency: 82.41, attack: 0.004, decay: 0.17, sustain: 0.38, release: 0.14, pitchSweep: 1, filterFrequency: 1250, filterQ: 8.5, noise: 0.005, click: 0.025, drive: 0.16, detune: 0 },
  },
  {
    id: 'synth', label: 'Synth', group: 'Tonal', voice: 'lead', defaultGain: 0.6,
    tags: ['tonal', 'lead', 'poly'],
    base: { oscillator: 'square', frequency: 110, attack: 0.025, decay: 0.23, sustain: 0.52, release: 0.34, pitchSweep: 1, filterFrequency: 2300, filterQ: 2.1, noise: 0.005, click: 0.015, drive: 0.08, detune: 4 },
  },
];

const SYNTH_TRACK_BLUEPRINTS = [
  {
    id: 'sub', label: 'Sub', group: 'Synth', voice: 'sub', defaultGain: 0.6,
    tags: ['synth', 'sub', 'mono'],
    base: { oscillator: 'sine', frequency: 43.65, attack: 0.008, decay: 0.36, sustain: 0.72, release: 0.28, filterFrequency: 310, filterQ: 0.8, drive: 0.04, detune: 0, spread: 0, harmonicity: 1, modulationIndex: 0, noise: 0 },
  },
  {
    id: 'tr808', label: '808', group: 'Synth', voice: 'subKick', defaultGain: 0.6,
    tags: ['synth', '808', 'bass-drum'],
    base: { oscillator: 'sine', frequency: 49, attack: 0.002, decay: 0.58, sustain: 0.16, release: 0.18, filterFrequency: 680, filterQ: 0.72, drive: 0.09, detune: 0, spread: 0, harmonicity: 1, modulationIndex: 0, noise: 0.025, pitchSweep: 3.4 },
  },
  {
    id: 'fmBass', label: 'FM', group: 'Synth', voice: 'fm', defaultGain: 0.5,
    tags: ['synth', 'fm', 'bass'],
    base: { oscillator: 'sine', frequency: 55, attack: 0.008, decay: 0.24, sustain: 0.5, release: 0.27, filterFrequency: 1600, filterQ: 1.25, drive: 0.075, detune: 0, spread: 0, harmonicity: 2, modulationIndex: 7.5, noise: 0 },
  },
  {
    id: 'pluck', label: 'Pluck', group: 'Synth', voice: 'pluck', defaultGain: 0.5,
    tags: ['synth', 'pluck', 'short'],
    base: { oscillator: 'triangle', frequency: 164.81, attack: 0.002, decay: 0.18, sustain: 0.08, release: 0.2, filterFrequency: 3500, filterQ: 2.4, drive: 0.035, detune: 3, spread: 6, harmonicity: 1, modulationIndex: 0, noise: 0.04 },
  },
  {
    id: 'amPad', label: 'AM', group: 'Synth', voice: 'pad', defaultGain: 0.5,
    tags: ['synth', 'am', 'pad'],
    base: { oscillator: 'sine', frequency: 130.81, attack: 0.16, decay: 0.48, sustain: 0.68, release: 0.72, filterFrequency: 2600, filterQ: 1.05, drive: 0.025, detune: 7, spread: 14, harmonicity: 1.5, modulationIndex: 0.45, noise: 0.008 },
  },
];

const SAMPLE_VARIANTS = [
  { id: 'tight', name: 'Tight', decay: 0.68, release: 0.72, pitch: 1.04, filter: 1.15, q: 1.08, noise: -0.055, click: 0.07, drive: -0.02 },
  { id: 'classic', name: 'Classic', decay: 1, release: 1, pitch: 1, filter: 1, q: 1, noise: 0, click: 0, drive: 0 },
  { id: 'driven', name: 'Driven', decay: 0.91, release: 0.88, pitch: 0.975, filter: 0.86, q: 1.24, noise: 0.075, click: 0.045, drive: 0.2 },
  { id: 'space', name: 'Space', decay: 1.37, release: 1.48, pitch: 0.945, filter: 0.73, q: 0.84, noise: 0.125, click: -0.035, drive: 0.07 },
];

const SYNTH_VARIANTS = [
  { id: 'techno', name: 'Techno', oscillator: 'sawtooth', attack: 0.78, decay: 0.82, sustain: 0.88, release: 0.76, filter: 0.82, q: 1.52, drive: 0.18, detune: 1.1, spread: 0.72, harmonicity: 1.05, modulation: 1.3 },
  { id: 'deep-house', name: 'Deep House', oscillator: 'triangle', attack: 1.18, decay: 1.2, sustain: 1.12, release: 1.28, filter: 0.64, q: 0.82, drive: 0.045, detune: 0.72, spread: 1.05, harmonicity: 0.91, modulation: 0.72 },
  { id: 'electro', name: 'Electro', oscillator: 'square', attack: 0.62, decay: 0.74, sustain: 0.74, release: 0.67, filter: 1.18, q: 1.22, drive: 0.13, detune: 1.26, spread: 0.68, harmonicity: 1.32, modulation: 1.16 },
  { id: 'trance', name: 'Trance', oscillator: 'sawtooth', attack: 0.88, decay: 1.06, sustain: 1.2, release: 1.42, filter: 1.37, q: 1.36, drive: 0.085, detune: 1.68, spread: 1.55, harmonicity: 1.2, modulation: 1.05 },
  { id: 'dnb', name: 'DnB', oscillator: 'square', attack: 0.48, decay: 0.58, sustain: 0.7, release: 0.55, filter: 0.94, q: 1.72, drive: 0.22, detune: 0.86, spread: 0.48, harmonicity: 1.46, modulation: 1.62 },
  { id: 'industrial', name: 'Industrial', oscillator: 'sawtooth', attack: 0.7, decay: 0.92, sustain: 0.82, release: 0.88, filter: 0.54, q: 1.93, drive: 0.37, detune: 1.92, spread: 1.22, harmonicity: 1.71, modulation: 1.88 },
  { id: 'acid', name: 'Acid', oscillator: 'sawtooth', attack: 0.52, decay: 0.67, sustain: 0.64, release: 0.61, filter: 1.54, q: 2.48, drive: 0.24, detune: 0.94, spread: 0.57, harmonicity: 1.14, modulation: 1.38 },
  { id: 'ambient', name: 'Ambient', oscillator: 'sine', attack: 2.35, decay: 1.72, sustain: 1.28, release: 2.6, filter: 0.77, q: 0.62, drive: 0.012, detune: 2.2, spread: 2.45, harmonicity: 0.78, modulation: 0.55 },
];

function adjusted(value, scale, addition = 0, minimum = 0) {
  return round(Math.max(minimum, value * scale + addition));
}

function makeSamplePreset(track, variant, variantIndex) {
  const base = track.base;
  const id = `${track.id}-${variant.id}`;
  const params = {
    ...base,
    voice: track.voice,
    seed: stableSeed(id),
    frequency: adjusted(base.frequency, variant.pitch, variantIndex * 0.017, 1),
    attack: adjusted(base.attack, variant.decay, variantIndex * 0.00007, 0.0001),
    decay: adjusted(base.decay, variant.decay, variantIndex * 0.00011, 0.015),
    release: adjusted(base.release, variant.release, variantIndex * 0.00013, 0.01),
    pitchSweep: adjusted(base.pitchSweep ?? 1, 1 + ((variant.pitch - 1) * 0.45), 0, 0.1),
    filterFrequency: adjusted(base.filterFrequency, variant.filter, variantIndex * 0.19, 40),
    filterQ: adjusted(base.filterQ, variant.q, variantIndex * 0.0017, 0.0001),
    noise: adjusted(base.noise ?? 0, 1, variant.noise, 0),
    click: adjusted(base.click ?? 0, 1, variant.click, 0),
    drive: adjusted(base.drive ?? 0, 1, variant.drive, 0),
  };

  return {
    id,
    trackId: track.id,
    name: `${variant.name} ${track.label}`,
    kind: 'procedural',
    engine: 'native-web-audio',
    provenance: PROVENANCE,
    networkRequired: false,
    guaranteedFallback: true,
    tags: [...track.tags, variant.id, 'offline'],
    params,
  };
}

function makeSynthPreset(track, variant, variantIndex) {
  const base = track.base;
  const id = `${track.id}-${variant.id}`;
  const safeOscillator = track.voice === 'sub' || track.voice === 'subKick'
    ? (variant.oscillator === 'sawtooth' ? 'triangle' : variant.oscillator)
    : variant.oscillator;
  const params = {
    ...base,
    voice: track.voice,
    oscillator: safeOscillator,
    seed: stableSeed(id),
    frequency: adjusted(base.frequency, 1 + ((variantIndex - 3.5) * 0.004), 0, 1),
    attack: adjusted(base.attack, variant.attack, variantIndex * 0.00009, 0.0001),
    decay: adjusted(base.decay, variant.decay, variantIndex * 0.00017, 0.01),
    sustain: round(Math.min(1, adjusted(base.sustain, variant.sustain, 0, 0))),
    release: adjusted(base.release, variant.release, variantIndex * 0.00023, 0.01),
    filterFrequency: adjusted(base.filterFrequency, variant.filter, variantIndex * 0.31, 40),
    filterQ: adjusted(base.filterQ, variant.q, variantIndex * 0.0023, 0.0001),
    drive: adjusted(base.drive, 1, variant.drive, 0),
    detune: adjusted(base.detune, variant.detune, variantIndex * 0.011, 0),
    spread: adjusted(base.spread, variant.spread, variantIndex * 0.013, 0),
    harmonicity: adjusted(base.harmonicity, variant.harmonicity, variantIndex * 0.0011, 0.05),
    modulationIndex: adjusted(base.modulationIndex, variant.modulation, variantIndex * 0.014, 0),
  };

  return {
    id,
    trackId: track.id,
    name: `${variant.name} ${track.label}`,
    kind: 'procedural',
    engine: 'native-web-audio',
    provenance: PROVENANCE,
    networkRequired: false,
    guaranteedFallback: true,
    tags: [...track.tags, variant.id, 'offline'],
    params,
  };
}

const presetList = [
  ...SAMPLE_TRACK_BLUEPRINTS.flatMap(track => (
    SAMPLE_VARIANTS.map((variant, index) => makeSamplePreset(track, variant, index))
  )),
  ...SYNTH_TRACK_BLUEPRINTS.flatMap(track => (
    SYNTH_VARIANTS.map((variant, index) => makeSynthPreset(track, variant, index))
  )),
];

/** Frozen preset map keyed by preset id. Contains 124 procedural presets. */
export const AUDIO_PRESET_REGISTRY = deepFreeze(Object.fromEntries(
  presetList.map(preset => [preset.id, preset]),
));

/** Frozen preset-id lists keyed by the existing DM99 track ids. */
export const PRESET_IDS_BY_TRACK = deepFreeze(Object.fromEntries(
  TRACK_IDS.map(trackId => [
    trackId,
    presetList.filter(preset => preset.trackId === trackId).map(preset => preset.id),
  ]),
));

const allBlueprints = [...SAMPLE_TRACK_BLUEPRINTS, ...SYNTH_TRACK_BLUEPRINTS];

/**
 * Frozen track metadata. `fallbackPresetId` always identifies a local,
 * deterministic preset and never a URL or third-party asset.
 */
export const TRACK_REGISTRY = deepFreeze(Object.fromEntries(
  allBlueprints.map(track => [track.id, {
    id: track.id,
    label: track.label,
    group: track.group,
    voice: track.voice,
    defaultGain: track.defaultGain,
    defaultPan: 0,
    tags: [...track.tags],
    provenance: PROVENANCE,
    networkRequired: false,
    guaranteedFallback: true,
    fallbackPresetId: PRESET_IDS_BY_TRACK[track.id][0],
  }]),
));

const KIT_BLUEPRINTS = [
  {
    id: 'techno', name: 'Techno', sample: 'driven',
    overrides: { hihatClosed: 'tight', hihatOpened: 'tight', crash: 'space', bass1: 'classic' },
    tags: ['four-on-the-floor', 'driven', 'club'],
  },
  {
    id: 'deep-house', name: 'Deep House', sample: 'classic',
    overrides: { kick: 'tight', clap: 'space', shaker: 'space', bass1: 'space' },
    tags: ['warm', 'round', 'laid-back'],
  },
  {
    id: 'electro', name: 'Electro', sample: 'tight',
    overrides: { cowbell: 'driven', perc2: 'driven', perc5: 'classic', synth: 'driven' },
    tags: ['precise', 'metallic', 'syncopated'],
  },
  {
    id: 'trance', name: 'Trance', sample: 'space',
    overrides: { kick: 'classic', hihatClosed: 'driven', hihatOpened: 'driven', clap: 'classic' },
    tags: ['wide', 'bright', 'uplifting'],
  },
  {
    id: 'dnb', name: 'DnB', sample: 'tight',
    overrides: { snare: 'driven', ride: 'space', perc1: 'driven', bass1: 'driven' },
    tags: ['fast', 'punchy', 'broken-beat'],
  },
  {
    id: 'industrial', name: 'Industrial', sample: 'driven',
    overrides: { crash: 'space', ride: 'space', perc3: 'space', perc6: 'tight' },
    tags: ['hard', 'metallic', 'distorted'],
  },
  {
    id: 'acid', name: 'Acid', sample: 'classic',
    overrides: { kick: 'driven', acid: 'driven', bass1: 'driven', hihatOpened: 'space' },
    tags: ['resonant', 'squelchy', '303-inspired'],
  },
  {
    id: 'ambient', name: 'Ambient', sample: 'space',
    overrides: { kick: 'classic', rimshot: 'tight', perc2: 'classic', shaker: 'classic' },
    tags: ['soft', 'long-tail', 'spacious'],
  },
];

function createKitSnapshot(kit) {
  const presets = {};

  for (const trackId of SAMPLE_STYLE_TRACK_IDS) {
    const variantId = kit.overrides[trackId] ?? kit.sample;
    presets[trackId] = `${trackId}-${variantId}`;
  }

  for (const trackId of SYNTH_TRACK_IDS) {
    presets[trackId] = `${trackId}-${kit.id}`;
  }

  return {
    id: kit.id,
    name: kit.name,
    description: `${kit.name} snapshot built entirely from DM99 procedural voices.`,
    provenance: PROVENANCE,
    networkRequired: false,
    guaranteedFallback: true,
    tags: [...kit.tags, 'procedural', 'offline'],
    presets,
  };
}

/** Eight complete kit snapshots; every snapshot selects all 26 tracks. */
export const KIT_SNAPSHOTS = deepFreeze(Object.fromEntries(
  KIT_BLUEPRINTS.map(kit => [kit.id, createKitSnapshot(kit)]),
));

/** Default zero-network kit id. */
export const DEFAULT_KIT_ID = 'techno';

/** Return immutable metadata for a track, or `undefined`. */
export function getTrackDefinition(trackId) {
  return TRACK_REGISTRY[trackId];
}

/** Return an immutable preset, or `undefined`. */
export function getAudioPreset(presetId) {
  return AUDIO_PRESET_REGISTRY[presetId];
}

/** Return all immutable presets available for a track. */
export function listAudioPresets(trackId) {
  return (PRESET_IDS_BY_TRACK[trackId] ?? []).map(getAudioPreset);
}

/** Return an immutable kit snapshot by id or display-name-like slug. */
export function getKitSnapshot(kitId = DEFAULT_KIT_ID) {
  return KIT_SNAPSHOTS[slug(String(kitId))];
}

/**
 * Resolve a requested preset while guaranteeing a procedural fallback for the
 * track. Throws only for an unknown track id.
 */
export function resolveAudioPreset(trackId, presetId) {
  const track = getTrackDefinition(trackId);
  if (!track) throw new RangeError(`Unknown DM99 track: ${trackId}`);
  const requested = getAudioPreset(presetId);
  if (requested?.trackId === trackId) return requested;
  return getAudioPreset(track.fallbackPresetId);
}

/**
 * Pure registry audit used by Node tests and optional runtime diagnostics.
 * It never creates audio nodes or touches browser globals.
 */
export function validateInstrumentRegistry() {
  const errors = [];
  const presets = Object.values(AUDIO_PRESET_REGISTRY);
  const parameterSignatures = new Map();

  if (TRACK_IDS.length !== 26 || new Set(TRACK_IDS).size !== 26) {
    errors.push('Track ids must contain exactly 26 unique entries.');
  }

  for (const trackId of TRACK_IDS) {
    const track = TRACK_REGISTRY[trackId];
    const presetIds = PRESET_IDS_BY_TRACK[trackId] ?? [];
    const minimum = SYNTH_TRACK_IDS.includes(trackId) ? 8 : 4;

    if (!track) errors.push(`Missing track metadata: ${trackId}`);
    if (presetIds.length < minimum) {
      errors.push(`${trackId} has ${presetIds.length} presets; expected at least ${minimum}.`);
    }

    for (const presetId of presetIds) {
      const preset = AUDIO_PRESET_REGISTRY[presetId];
      if (!preset || preset.trackId !== trackId) errors.push(`Invalid preset mapping: ${presetId}`);
    }
  }

  for (const preset of presets) {
    if (preset.provenance !== PROVENANCE) errors.push(`${preset.id} has invalid provenance.`);
    if (preset.networkRequired !== false || preset.guaranteedFallback !== true) {
      errors.push(`${preset.id} is not marked as a guaranteed offline fallback.`);
    }

    const signature = JSON.stringify(preset.params, Object.keys(preset.params).sort());
    const duplicate = parameterSignatures.get(signature);
    if (duplicate) errors.push(`${preset.id} duplicates parameters from ${duplicate}.`);
    else parameterSignatures.set(signature, preset.id);
  }

  if (Object.keys(KIT_SNAPSHOTS).length !== 8) errors.push('Exactly eight kit snapshots are required.');
  for (const kitName of KIT_NAMES) {
    if (!Object.values(KIT_SNAPSHOTS).some(kit => kit.name === kitName)) {
      errors.push(`Missing kit snapshot: ${kitName}`);
    }
  }

  for (const kit of Object.values(KIT_SNAPSHOTS)) {
    if (Object.keys(kit.presets).length !== TRACK_IDS.length) {
      errors.push(`${kit.name} does not cover all 26 tracks.`);
    }
    for (const trackId of TRACK_IDS) {
      const preset = AUDIO_PRESET_REGISTRY[kit.presets[trackId]];
      if (!preset || preset.trackId !== trackId) {
        errors.push(`${kit.name} has an invalid ${trackId} selection.`);
      }
    }
  }

  return deepFreeze({
    valid: errors.length === 0,
    errors,
    counts: {
      tracks: TRACK_IDS.length,
      sampleStyleTracks: SAMPLE_STYLE_TRACK_IDS.length,
      synthTracks: SYNTH_TRACK_IDS.length,
      presets: presets.length,
      kits: Object.keys(KIT_SNAPSHOTS).length,
    },
  });
}

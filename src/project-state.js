import {
  DEFAULT_ADSR,
  DEFAULT_EFFECTS,
  DEFAULT_GENERATOR_SETTINGS,
  DEFAULT_INSTRUMENT_VOLUMES,
  DEFAULT_KIT_ID,
  DEFAULT_PRESET_IDS,
  DEFAULT_SEQUENCE_LENGTH,
  DEFAULT_STEP,
  INSTRUMENT_IDS,
  PATTERN_LIMITS,
  PATTERN_SLOT_IDS,
  PROJECT_STATE_VERSION,
  SCALE_IDS,
  normalizeGenreId,
  normalizeVariationId,
} from './pattern-constants.js';

const OWN = Object.prototype.hasOwnProperty;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, fallback) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function boundedNumber(value, fallback, min, max) {
  return clamp(finiteNumber(value, fallback), min, max);
}

function boundedInteger(value, fallback, min, max) {
  return Math.round(boundedNumber(value, fallback, min, max));
}

function normalizedBoolean(value, fallback = false) {
  if (value === true || value === 1 || value === 'true') return true;
  if (value === false || value === 0 || value === 'false') return false;
  return fallback;
}

function resolveSequenceLength(source) {
  const explicit = source.sequenceLength ?? source.length;
  if (explicit !== undefined) {
    return boundedInteger(
      explicit,
      DEFAULT_SEQUENCE_LENGTH,
      PATTERN_LIMITS.minLength,
      PATTERN_LIMITS.maxLength,
    );
  }

  const inferredFromSequences = INSTRUMENT_IDS
    .map((instrumentId) => source.sequences?.[instrumentId])
    .find(Array.isArray)?.length;
  const activePattern = normalizeActivePattern(source.activePattern);
  const activeSlot = source.patterns?.[activePattern] ?? source.patterns?.[activePattern.toLowerCase()];
  const patternSequences = isRecord(activeSlot?.sequences) ? activeSlot.sequences : activeSlot;
  const inferredFromPatterns = INSTRUMENT_IDS
    .map((instrumentId) => patternSequences?.[instrumentId])
    .find(Array.isArray)?.length;

  return boundedInteger(
    inferredFromSequences ?? inferredFromPatterns,
    DEFAULT_SEQUENCE_LENGTH,
    PATTERN_LIMITS.minLength,
    PATTERN_LIMITS.maxLength,
  );
}

function normalizeSeed(value, fallback = 'dm99') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  const seed = String(value).trim();
  if (!seed) return fallback;
  return seed.slice(0, PATTERN_LIMITS.maxSeedLength);
}

function boundedIdentifier(value, fallback, { optional = false } = {}) {
  const normalized = boundedText(value, optional ? '' : fallback, PATTERN_LIMITS.maxIdentifierLength);
  if (optional && normalized === '') return '';
  return SAFE_IDENTIFIER.test(normalized) ? normalized : fallback;
}

function boundedText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

export function normalizeStep(value) {
  const source = typeof value === 'boolean'
    ? { active: value }
    : isRecord(value) ? value : {};
  const scale = typeof source.scale === 'string' && SCALE_IDS.includes(source.scale)
    ? source.scale
    : DEFAULT_STEP.scale;

  return {
    active: normalizedBoolean(source.active, DEFAULT_STEP.active),
    pitch: boundedInteger(
      source.pitch,
      DEFAULT_STEP.pitch,
      PATTERN_LIMITS.minPitch,
      PATTERN_LIMITS.maxPitch,
    ),
    scale,
    velocity: boundedNumber(
      source.velocity,
      DEFAULT_STEP.velocity,
      PATTERN_LIMITS.minVelocity,
      PATTERN_LIMITS.maxVelocity,
    ),
    probability: boundedNumber(
      source.probability,
      DEFAULT_STEP.probability,
      PATTERN_LIMITS.minProbability,
      PATTERN_LIMITS.maxProbability,
    ),
    ratchet: boundedInteger(
      source.ratchet,
      DEFAULT_STEP.ratchet,
      PATTERN_LIMITS.minRatchet,
      PATTERN_LIMITS.maxRatchet,
    ),
    nudgeMs: boundedInteger(
      source.nudgeMs,
      DEFAULT_STEP.nudgeMs,
      PATTERN_LIMITS.minNudgeMs,
      PATTERN_LIMITS.maxNudgeMs,
    ),
    accent: normalizedBoolean(source.accent, DEFAULT_STEP.accent),
    slide: normalizedBoolean(source.slide, DEFAULT_STEP.slide),
  };
}

export function createDefaultStep(overrides = {}) {
  return normalizeStep(overrides);
}

export function normalizeSequence(sequence, length = DEFAULT_SEQUENCE_LENGTH) {
  const safeLength = boundedInteger(
    length,
    DEFAULT_SEQUENCE_LENGTH,
    PATTERN_LIMITS.minLength,
    PATTERN_LIMITS.maxLength,
  );
  const source = Array.isArray(sequence) ? sequence : [];
  return Array.from({ length: safeLength }, (_, index) => normalizeStep(source[index]));
}

function normalizeFlagMap(source, instrumentIds = INSTRUMENT_IDS) {
  const values = isRecord(source) ? source : {};
  return Object.fromEntries(
    instrumentIds.map((instrumentId) => [
      instrumentId,
      normalizedBoolean(values[instrumentId], false),
    ]),
  );
}

function normalizeSequencesMap(source, sequenceLength) {
  const values = isRecord(source) ? source : {};
  return Object.fromEntries(INSTRUMENT_IDS.map((instrumentId) => [
    instrumentId,
    normalizeSequence(values[instrumentId], sequenceLength),
  ]));
}

function normalizeActivePattern(value) {
  if (typeof value !== 'string') return 'A';
  const patternId = value.trim().toUpperCase();
  return PATTERN_SLOT_IDS.includes(patternId) ? patternId : 'A';
}

function normalizePatterns(source, sequenceLength, activePattern, legacySequences) {
  const values = isRecord(source) ? source : {};
  return Object.fromEntries(PATTERN_SLOT_IDS.map((patternId) => {
    const slot = values[patternId] ?? values[patternId.toLowerCase()];
    const slotSequences = isRecord(slot?.sequences) ? slot.sequences : slot;
    const fallback = patternId === activePattern && !isRecord(slotSequences)
      ? legacySequences
      : slotSequences;
    return [patternId, normalizeSequencesMap(fallback, sequenceLength)];
  }));
}

function normalizeVolumes(source) {
  const values = isRecord(source) ? source : {};
  return Object.fromEntries(INSTRUMENT_IDS.map((instrumentId) => [
    instrumentId,
    boundedNumber(
      values[instrumentId],
      DEFAULT_INSTRUMENT_VOLUMES[instrumentId],
      0,
      1,
    ),
  ]));
}

function normalizeAdsrEnvelope(source, fallback) {
  const value = isRecord(source) ? source : {};
  return {
    attack: boundedNumber(value.attack, fallback.attack, 0, 1),
    decay: boundedNumber(value.decay, fallback.decay, 0, 2),
    sustain: boundedNumber(value.sustain, fallback.sustain, 0, 1),
    release: boundedNumber(value.release, fallback.release, 0, 2),
  };
}

function normalizeAdsr(source) {
  const values = isRecord(source) ? source : {};
  return Object.fromEntries(Object.entries(DEFAULT_ADSR).map(([instrumentId, fallback]) => [
    instrumentId,
    normalizeAdsrEnvelope(values[instrumentId], fallback),
  ]));
}

function normalizeSampleMetadata(source, instrumentId) {
  const value = isRecord(source) ? source : {};
  const defaultSource = 'procedural';
  const allowedSources = ['procedural', 'remote', 'custom', 'tone', 'unknown'];
  const sampleSource = typeof value.source === 'string' && allowedSources.includes(value.source)
    ? value.source
    : defaultSource;
  const requestedStart = boundedNumber(value.start, 0, 0, 1);
  const requestedEnd = boundedNumber(value.end, 1, 0, 1);
  const start = Math.min(requestedStart, requestedEnd);
  const end = Math.max(requestedStart, requestedEnd);
  const allowedModes = ['one-shot', 'gate', 'loop'];

  return {
    id: boundedIdentifier(value.id, '', { optional: true }),
    name: boundedText(value.name ?? value.fileName, '', PATTERN_LIMITS.maxMetadataTextLength),
    url: boundedText(value.url, '', PATTERN_LIMITS.maxSampleUrlLength),
    source: sampleSource,
    mimeType: boundedText(value.mimeType, '', PATTERN_LIMITS.maxMetadataTextLength),
    license: boundedText(value.license, '', PATTERN_LIMITS.maxMetadataTextLength),
    attribution: boundedText(value.attribution, '', PATTERN_LIMITS.maxMetadataTextLength),
    start,
    end,
    tune: boundedNumber(
      value.tune,
      0,
      PATTERN_LIMITS.minTune,
      PATTERN_LIMITS.maxTune,
    ),
    mode: typeof value.mode === 'string' && allowedModes.includes(value.mode)
      ? value.mode
      : 'one-shot',
  };
}

function normalizeTrackSettings(source) {
  const values = isRecord(source) ? source : {};
  return Object.fromEntries(INSTRUMENT_IDS.map((instrumentId) => {
    const track = isRecord(values[instrumentId]) ? values[instrumentId] : {};
    const legacySample = {
      id: track.sampleId,
      name: track.sampleName,
      url: track.sampleUrl,
      source: track.sampleSource,
      mimeType: track.sampleMimeType,
      license: track.sampleLicense,
      attribution: track.sampleAttribution,
      start: track.sampleStart,
      end: track.sampleEnd,
      tune: track.sampleTune,
      mode: track.sampleMode,
    };
    return [instrumentId, {
      presetId: boundedIdentifier(
        track.presetId,
        DEFAULT_PRESET_IDS[instrumentId],
      ),
      pan: boundedNumber(
        track.pan,
        0,
        PATTERN_LIMITS.minPan,
        PATTERN_LIMITS.maxPan,
      ),
      chokeGroup: boundedIdentifier(
        track.chokeGroup,
        '',
        { optional: true },
      ),
      sample: normalizeSampleMetadata(track.sample ?? legacySample, instrumentId),
    }];
  }));
}

function normalizeEq(source) {
  const value = isRecord(source) ? source : {};
  return {
    low: boundedNumber(value.low, 0, PATTERN_LIMITS.minEqDb, PATTERN_LIMITS.maxEqDb),
    mid: boundedNumber(value.mid, 0, PATTERN_LIMITS.minEqDb, PATTERN_LIMITS.maxEqDb),
    high: boundedNumber(value.high, 0, PATTERN_LIMITS.minEqDb, PATTERN_LIMITS.maxEqDb),
  };
}

function normalizeEffects(source) {
  const value = isRecord(source) ? source : {};
  return {
    masterVolume: boundedNumber(value.masterVolume, DEFAULT_EFFECTS.masterVolume, 0, 1),
    drive: boundedNumber(value.drive, DEFAULT_EFFECTS.drive, 0, 1),
    delayWet: boundedNumber(value.delayWet, DEFAULT_EFFECTS.delayWet, 0, 1),
    reverbWet: boundedNumber(value.reverbWet, DEFAULT_EFFECTS.reverbWet, 0, 1),
    lowpassHz: boundedNumber(
      value.lowpassHz ?? value.lowpass,
      DEFAULT_EFFECTS.lowpassHz,
      PATTERN_LIMITS.minLowpassHz,
      PATTERN_LIMITS.maxLowpassHz,
    ),
    highpassHz: boundedNumber(
      value.highpassHz ?? value.highpass,
      DEFAULT_EFFECTS.highpassHz,
      PATTERN_LIMITS.minHighpassHz,
      PATTERN_LIMITS.maxHighpassHz,
    ),
    masterEq: normalizeEq(value.masterEq ?? value.eq ?? DEFAULT_EFFECTS.masterEq),
    bassEq: normalizeEq(value.bassEq ?? DEFAULT_EFFECTS.bassEq),
  };
}

function normalizeGeneratorSettings(source) {
  const generator = isRecord(source.generator) ? source.generator : {};
  return {
    genre: normalizeGenreId(generator.genre ?? source.genre) || DEFAULT_GENERATOR_SETTINGS.genre,
    energy: boundedNumber(
      generator.energy ?? source.energy,
      DEFAULT_GENERATOR_SETTINGS.energy,
      PATTERN_LIMITS.minEnergy,
      PATTERN_LIMITS.maxEnergy,
    ),
    seed: normalizeSeed(generator.seed ?? source.seed, DEFAULT_GENERATOR_SETTINGS.seed),
    variation: normalizeVariationId(generator.variation ?? source.variation) || DEFAULT_GENERATOR_SETTINGS.variation,
    complexity: boundedNumber(generator.complexity ?? source.complexity, DEFAULT_GENERATOR_SETTINGS.complexity, 0, 1),
    syncopation: boundedNumber(generator.syncopation ?? source.syncopation, DEFAULT_GENERATOR_SETTINGS.syncopation, 0, 1),
    humanize: boundedNumber(generator.humanize ?? source.humanize, DEFAULT_GENERATOR_SETTINGS.humanize, 0, 1),
  };
}

export function normalizeProjectState(value = {}) {
  const source = isRecord(value) ? value : {};
  const sourceVersion = finiteNumber(source.version, 2);
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > PROJECT_STATE_VERSION) {
    throw new RangeError(`Unsupported project version: ${sourceVersion}`);
  }

  const sequenceLength = resolveSequenceLength(source);
  const sourceSequences = isRecord(source.sequences) ? source.sequences : {};
  const activePattern = normalizeActivePattern(source.activePattern);
  const patterns = normalizePatterns(source.patterns, sequenceLength, activePattern, sourceSequences);
  const sequences = normalizeSequencesMap(patterns[activePattern], sequenceLength);

  return {
    version: PROJECT_STATE_VERSION,
    projectName: boundedText(
      source.projectName,
      'Untitled Project',
      PATTERN_LIMITS.maxProjectNameLength,
    ),
    kitId: boundedIdentifier(source.kitId, DEFAULT_KIT_ID),
    sequenceLength,
    sequences,
    patterns,
    activePattern,
    tempo: boundedNumber(
      source.tempo,
      120,
      PATTERN_LIMITS.minBpm,
      PATTERN_LIMITS.maxBpm,
    ),
    swing: boundedNumber(
      source.swing,
      0,
      PATTERN_LIMITS.minSwing,
      PATTERN_LIMITS.maxSwing,
    ),
    volumes: normalizeVolumes(source.volumes),
    muted: normalizeFlagMap(source.muted),
    soloed: normalizeFlagMap(source.soloed),
    adsr: normalizeAdsr(source.adsr),
    locks: normalizeFlagMap(source.locks),
    trackSettings: normalizeTrackSettings(source.trackSettings),
    effects: normalizeEffects(source.effects),
    generator: normalizeGeneratorSettings(source),
  };
}

export function migrateProjectState(value) {
  return normalizeProjectState(value);
}

export function migrateProjectV2ToV3(value) {
  if (!isRecord(value) || (OWN.call(value, 'version') && Number(value.version) !== 2)) {
    throw new TypeError('Expected a version 2 project object.');
  }
  return normalizeProjectState({ ...value, version: 2 });
}

export function createDefaultProjectState(options = {}) {
  return normalizeProjectState({
    version: PROJECT_STATE_VERSION,
    sequenceLength: options.sequenceLength,
    generator: options.generator,
  });
}

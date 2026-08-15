/**
 * Small, dependency-free DSP helpers for DM99's native Web Audio engine.
 * Importing this module is safe in Node; browser objects are only consumed by
 * functions that explicitly receive an AudioContext or AudioParam.
 */

export function clamp(value, minimum, maximum, fallback = minimum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

export function dbToGain(decibels) {
  return 10 ** (Number(decibels) / 20);
}

export function midiToFrequency(midiNote, tuning = 440) {
  return Number(tuning) * (2 ** ((Number(midiNote) - 69) / 12));
}

export function frequencyWithSemitoneOffset(baseFrequency, semitones = 0) {
  return Number(baseFrequency) * (2 ** (Number(semitones) / 12));
}

export function createSeededRandom(seed = 1) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function isAudioBufferLike(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && Number.isFinite(value.length)
      && Number.isFinite(value.sampleRate)
      && Number.isFinite(value.numberOfChannels)
      && typeof value.getChannelData === 'function',
  );
}

/** Create a deterministic white, pink, or brown noise AudioBuffer. */
export function createNoiseBuffer(context, {
  duration = 1,
  seed = 1,
  color = 'white',
  channels = 1,
} = {}) {
  if (!context || typeof context.createBuffer !== 'function') {
    throw new TypeError('A Web Audio context is required to create a noise buffer.');
  }

  const safeDuration = clamp(duration, 0.01, 8, 1);
  const channelCount = Math.trunc(clamp(channels, 1, 2, 1));
  const length = Math.max(1, Math.ceil(context.sampleRate * safeDuration));
  const buffer = context.createBuffer(channelCount, length, context.sampleRate);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const random = createSeededRandom((Number(seed) + (channel * 2654435761)) >>> 0);
    const data = buffer.getChannelData(channel);
    let brown = 0;
    let pink0 = 0;
    let pink1 = 0;
    let pink2 = 0;

    for (let index = 0; index < length; index += 1) {
      const white = (random() * 2) - 1;
      let sample = white;

      if (color === 'brown') {
        brown = (brown + (0.02 * white)) / 1.02;
        sample = brown * 3.5;
      } else if (color === 'pink') {
        pink0 = (0.99765 * pink0) + (white * 0.099046);
        pink1 = (0.963 * pink1) + (white * 0.2965164);
        pink2 = (0.57 * pink2) + (white * 1.0526913);
        sample = (pink0 + pink1 + pink2 + (white * 0.1848)) * 0.05;
      }

      data[index] = clamp(sample, -1, 1, 0);
    }
  }

  return buffer;
}

/** Create a deterministic stereo impulse for the built-in convolution send. */
export function createImpulseResponse(context, {
  duration = 1.8,
  decay = 2.4,
  reverse = false,
  seed = 99173,
} = {}) {
  if (!context || typeof context.createBuffer !== 'function') {
    throw new TypeError('A Web Audio context is required to create an impulse response.');
  }

  const safeDuration = clamp(duration, 0.08, 8, 1.8);
  const safeDecay = clamp(decay, 0.2, 12, 2.4);
  const length = Math.max(1, Math.ceil(context.sampleRate * safeDuration));
  const impulse = context.createBuffer(2, length, context.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    const random = createSeededRandom((seed + (channel * 104729)) >>> 0);

    for (let index = 0; index < length; index += 1) {
      const position = reverse ? length - index : index;
      const envelope = (1 - (position / length)) ** safeDecay;
      data[index] = (((random() * 2) - 1) * envelope);
    }
  }

  return impulse;
}

/** Return a WaveShaper curve. Amount zero is effectively linear. */
export function createDriveCurve(amount = 0, sampleCount = 2048) {
  const drive = clamp(amount, 0, 1, 0);
  const length = Math.trunc(clamp(sampleCount, 256, 65536, 2048));
  const curve = new Float32Array(length);
  const strength = 1 + (drive * 120);

  for (let index = 0; index < length; index += 1) {
    const input = ((index * 2) / (length - 1)) - 1;
    curve[index] = Math.tanh(input * strength) / Math.tanh(strength);
  }

  return curve;
}

export function setAudioParam(param, value, time = 0) {
  if (!param) return;
  if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, time);
  else param.value = value;
}

export function setAudioParamSmooth(param, value, time = 0, smoothing = 0.012) {
  if (!param) return;
  if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(time);
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, time, Math.max(0.001, smoothing));
  } else {
    setAudioParam(param, value, time);
  }
}

/** Schedule a click-free ADSR envelope and return its absolute end time. */
export function scheduleEnvelope(param, {
  time,
  attack = 0.002,
  decay = 0.2,
  sustain = 0,
  release = 0.08,
  duration,
  peak = 1,
} = {}) {
  const start = Math.max(0, Number(time) || 0);
  const safeAttack = clamp(attack, 0.0001, 20, 0.002);
  const safeDecay = clamp(decay, 0.001, 30, 0.2);
  const safeSustain = clamp(sustain, 0, 1, 0);
  const safeRelease = clamp(release, 0.001, 30, 0.08);
  const safePeak = clamp(peak, 0.0001, 4, 1);
  const floor = 0.00001;
  const attackEnd = start + safeAttack;
  const decayEnd = attackEnd + safeDecay;
  const minimumGate = safeSustain > 0 ? safeAttack + safeDecay : 0;
  const requestedGate = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : minimumGate;
  const releaseStart = Math.max(decayEnd, start + requestedGate);
  const end = releaseStart + safeRelease;

  if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(start);
  setAudioParam(param, floor, start);

  if (typeof param.linearRampToValueAtTime === 'function') {
    param.linearRampToValueAtTime(safePeak, attackEnd);
  } else {
    setAudioParam(param, safePeak, attackEnd);
  }

  const sustainValue = Math.max(floor, safePeak * safeSustain);
  if (typeof param.exponentialRampToValueAtTime === 'function') {
    param.exponentialRampToValueAtTime(sustainValue, decayEnd);
  } else {
    setAudioParam(param, sustainValue, decayEnd);
  }

  setAudioParam(param, sustainValue, releaseStart);
  if (typeof param.exponentialRampToValueAtTime === 'function') {
    param.exponentialRampToValueAtTime(floor, end);
  } else {
    setAudioParam(param, floor, end);
  }

  return end;
}

export function safeStop(source, time) {
  if (!source || typeof source.stop !== 'function') return;
  try {
    if (Number.isFinite(time)) source.stop(time);
    else source.stop();
  } catch {
    // A source may already be stopped; stopping remains intentionally idempotent.
  }
}

export function safeDisconnect(node) {
  if (!node || typeof node.disconnect !== 'function') return;
  try {
    node.disconnect();
  } catch {
    // Some implementations throw when an already-disconnected node is reused.
  }
}

/** Normalize DM99's expressive step fields without touching audio globals. */
export function normalizeExpressiveStep(step = {}) {
  const accent = typeof step.accent === 'number'
    ? clamp(step.accent, 0.25, 2, 1)
    : step.accent ? 1.22 : 1;

  return Object.freeze({
    active: step.active !== false,
    velocity: clamp(step.velocity, 0, 1, 0.8),
    accent,
    probability: clamp(step.probability, 0, 1, 1),
    ratchet: Math.trunc(clamp(step.ratchet, 1, 8, 1)),
    nudgeMs: clamp(step.nudgeMs ?? step.nudge, -250, 250, 0),
    pitch: clamp(step.pitch, -48, 48, 0),
    midi: Number.isFinite(Number(step.midi)) ? clamp(step.midi, 0, 127, 60) : null,
    frequency: Number.isFinite(Number(step.frequency))
      ? clamp(step.frequency, 8, 24000, 440)
      : null,
    duration: Number.isFinite(Number(step.duration))
      ? clamp(step.duration, 0.005, 30, 0.125)
      : null,
    slide: step.slide === true,
    slideTime: Number.isFinite(Number(step.slideTime))
      ? clamp(step.slideTime, 0.005, 0.5, 0.06)
      : 0.06,
    presetId: typeof step.presetId === 'string' ? step.presetId : null,
    forceProcedural: step.forceProcedural === true,
  });
}

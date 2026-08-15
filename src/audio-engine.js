/**
 * Native, zero-network Web Audio engine for DM99.
 *
 * Integration contract:
 * - Constructing `AudioEngine` is side-effect free.
 * - Call `initializeFromGesture()` directly inside a pointer/keyboard handler.
 * - Use `scheduleStep()` for expressive sequencer entries or `preview()` for UI
 *   auditioning.
 * - Every existing DM99 track has a procedural fallback; user AudioBuffers are
 *   optional overrides and never remove that fallback.
 */

import {
  AUDIO_PRESET_REGISTRY,
  DEFAULT_KIT_ID,
  KIT_SNAPSHOTS,
  TRACK_IDS,
  TRACK_REGISTRY,
  getKitSnapshot,
  resolveAudioPreset,
} from './instruments.js';
import {
  clamp,
  createDriveCurve,
  createImpulseResponse,
  createNoiseBuffer,
  createSeededRandom,
  frequencyWithSemitoneOffset,
  isAudioBufferLike,
  midiToFrequency,
  normalizeExpressiveStep,
  safeDisconnect,
  safeStop,
  scheduleEnvelope,
  setAudioParam,
  setAudioParamSmooth,
} from './audio-dsp.js';

const OSCILLATOR_TYPES = new Set(['sine', 'square', 'sawtooth', 'triangle']);

/** Supported user-buffer playback modes. */
export const USER_BUFFER_MODES = Object.freeze(['one-shot', 'gate', 'loop']);
const USER_BUFFER_MODE_SET = new Set(USER_BUFFER_MODES);

function assertTrackId(trackId) {
  if (!TRACK_REGISTRY[trackId]) throw new RangeError(`Unknown DM99 track: ${trackId}`);
}

function defaultContextFactory(options) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof Context !== 'function') {
    throw new Error('This browser does not expose the Web Audio API.');
  }
  return new Context(options);
}

function connectChain(...nodes) {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    nodes[index].connect(nodes[index + 1]);
  }
}

function safeFilterFrequency(filter, frequency) {
  const requested = Number(frequency);
  const fallback = Number.isFinite(requested) ? requested : 1000;
  const sampleRate = Number(filter?.context?.sampleRate);
  const maximum = Number.isFinite(sampleRate) && sampleRate > 0
    ? Math.max(20, sampleRate * 0.45)
    : 22000;
  return Math.min(maximum, Math.max(10, fallback));
}

function safeOscillatorFrequency(oscillator, frequency) {
  const requested = Number(frequency);
  const fallback = Number.isFinite(requested) ? requested : 440;
  const sampleRate = Number(oscillator?.context?.sampleRate);
  const maximum = Number.isFinite(sampleRate) && sampleRate > 0
    ? Math.max(20, sampleRate * 0.45)
    : 22000;
  return Math.min(maximum, Math.max(0.01, fallback));
}

function setFilter(filter, type, frequency, q, time = 0) {
  filter.type = type;
  setAudioParam(filter.frequency, safeFilterFrequency(filter, frequency), time);
  if (filter.Q) setAudioParam(filter.Q, q, time);
}

function oscillatorType(value, fallback = 'sine') {
  return OSCILLATOR_TYPES.has(value) ? value : fallback;
}

function normalizeUserBufferMode(mode, legacyLoop = false) {
  if (USER_BUFFER_MODE_SET.has(mode)) return mode;
  return legacyLoop ? 'loop' : 'one-shot';
}

function normalizeChokeGroup(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('chokeGroup must be a string, number, or empty value.');
  }
  return String(value).trim().slice(0, 64);
}

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function makeInitialTrackState(trackId, kit) {
  const definition = TRACK_REGISTRY[trackId];
  return {
    id: trackId,
    presetId: kit.presets[trackId],
    gain: definition.defaultGain,
    pan: definition.defaultPan,
    muted: false,
    solo: false,
    chokeGroup: '',
    filter: {
      highpass: 20,
      lowpass: 20000,
      q: 0.7,
    },
    sends: {
      delay: 0,
      reverb: definition.group === 'Cymbals' ? 0.12 : 0.04,
    },
    readiness: 'idle',
    error: null,
  };
}

/**
 * Dependency-free native Web Audio playback and synthesis engine.
 */
export class AudioEngine {
  static isSupported() {
    return typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === 'function';
  }

  constructor({
    contextFactory = defaultContextFactory,
    random = Math.random,
    initialKit = DEFAULT_KIT_ID,
    latencyHint = 'interactive',
    sampleRate,
    masterGain = 0.82,
  } = {}) {
    if (typeof contextFactory !== 'function') throw new TypeError('contextFactory must be a function.');
    if (typeof random !== 'function') throw new TypeError('random must be a function.');

    const kit = getKitSnapshot(initialKit);
    if (!kit) throw new RangeError(`Unknown DM99 kit snapshot: ${initialKit}`);

    this.context = null;
    this.status = 'idle';
    this.currentKitId = kit.id;
    this._contextFactory = contextFactory;
    this._contextOptions = {
      latencyHint,
      ...(Number.isFinite(Number(sampleRate)) ? { sampleRate: Number(sampleRate) } : {}),
    };
    this._random = random;
    this._initialization = null;
    this._disposed = false;
    this._masterNodes = null;
    this._effectNodes = null;
    this._trackNodes = new Map();
    this._trackStates = new Map(TRACK_IDS.map(trackId => [trackId, makeInitialTrackState(trackId, kit)]));
    this._userBuffers = new Map();
    this._noiseBuffers = new Map();
    this._activeVoices = new Map();
    this._lastTonalFrequencies = new Map();
    this._nextVoiceId = 1;
    this._masterState = {
      gain: clamp(masterGain, 0, 2, 0.82),
      eq: { low: 0, mid: 0, high: 0 },
      filter: { highpass: 20, lowpass: 20000 },
      compressor: {
        threshold: -24,
        knee: 24,
        ratio: 6,
        attack: 0.003,
        release: 0.2,
      },
    };
    this._delayState = { time: 0.25, feedback: 0.26, wet: 0.16 };
    this._reverbState = { duration: 1.8, decay: 2.4, wet: 0.18, seed: 99173 };
  }

  /**
   * Create and resume the AudioContext. Invoke synchronously from a user gesture
   * handler; no AudioContext is created before this method is called.
   */
  async initializeFromGesture() {
    this._assertNotDisposed();

    if (this.status === 'initializing' && this._initialization) return this._initialization;
    if (this.context) {
      await this.resume();
      return this.getReadinessSnapshot();
    }

    this.status = 'initializing';
    for (const state of this._trackStates.values()) {
      state.readiness = 'initializing';
      state.error = null;
    }

    // Context creation is deliberately synchronous so this call can retain the
    // browser's user-activation token.
    let context;
    try {
      context = this._contextFactory(this._contextOptions);
      if (!context || typeof context.createGain !== 'function') {
        throw new TypeError('contextFactory did not return a Web Audio context.');
      }
      if (typeof context.then === 'function') {
        throw new TypeError('contextFactory must return an AudioContext synchronously.');
      }
      this.context = context;
      this._buildGraph();
    } catch (error) {
      this._disconnectGraph();
      this.context = null;
      if (context && context.state !== 'closed' && typeof context.close === 'function') {
        try {
          const closing = context.close();
          if (closing && typeof closing.catch === 'function') closing.catch(() => {});
        } catch {
          // A partially constructed context is best-effort cleanup only.
        }
      }
      this._markInitializationError(error);
      throw error;
    }

    this._initialization = (async () => {
      try {
        if (context.state === 'suspended' && typeof context.resume === 'function') {
          await context.resume();
        }
        this.status = 'ready';
        for (const state of this._trackStates.values()) {
          state.readiness = 'ready';
          state.error = null;
        }
        return this.getReadinessSnapshot();
      } catch (error) {
        this._markInitializationError(error);
        this._initialization = null;
        throw error;
      }
    })();

    return this._initialization;
  }

  /** Resume a previously created context. */
  async resume() {
    this._assertNotDisposed();
    if (!this.context) return this.initializeFromGesture();
    try {
      if (this.context.state === 'closed') throw new Error('The AudioContext is closed.');
      if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
        await this.context.resume();
      }
      this.status = 'ready';
      for (const state of this._trackStates.values()) {
        state.readiness = 'ready';
        state.error = null;
      }
      return this.getReadinessSnapshot();
    } catch (error) {
      this._markInitializationError(error);
      throw error;
    }
  }

  /** Suspend rendering without discarding mixer state or cached buffers. */
  async suspend() {
    if (this.context?.state === 'running' && typeof this.context.suspend === 'function') {
      await this.context.suspend();
    }
  }

  getReadinessSnapshot() {
    return Object.freeze(Object.fromEntries(
      TRACK_IDS.map(trackId => [trackId, this.getTrackReadiness(trackId)]),
    ));
  }

  getTrackReadiness(trackId) {
    assertTrackId(trackId);
    const state = this._trackStates.get(trackId);
    const userBuffer = this._userBuffers.get(trackId);
    const hasUserBuffer = Boolean(userBuffer);
    return Object.freeze({
      trackId,
      state: state.readiness,
      ready: state.readiness === 'ready',
      source: hasUserBuffer ? 'user-buffer' : 'procedural',
      presetId: state.presetId,
      provenance: hasUserBuffer ? 'user-provided' : 'DM99-generated',
      guaranteedFallback: true,
      bufferMode: userBuffer?.mode ?? null,
      error: state.error,
    });
  }

  getTrackState(trackId) {
    assertTrackId(trackId);
    const state = this._trackStates.get(trackId);
    return Object.freeze({
      ...state,
      filter: Object.freeze({ ...state.filter }),
      sends: Object.freeze({ ...state.sends }),
      effectiveGain: this._effectiveTrackGain(trackId),
      hasUserBuffer: this._userBuffers.has(trackId),
    });
  }

  /** Select all 26 presets from one of the eight registry snapshots. */
  applyKit(kitId) {
    const kit = getKitSnapshot(kitId);
    if (!kit) throw new RangeError(`Unknown DM99 kit snapshot: ${kitId}`);
    for (const trackId of TRACK_IDS) this._trackStates.get(trackId).presetId = kit.presets[trackId];
    this.currentKitId = kit.id;
    return kit;
  }

  setTrackPreset(trackId, presetId) {
    assertTrackId(trackId);
    const preset = resolveAudioPreset(trackId, presetId);
    this._trackStates.get(trackId).presetId = preset.id;
    return preset;
  }

  setTrackGain(trackId, gain) {
    assertTrackId(trackId);
    const state = this._trackStates.get(trackId);
    state.gain = clamp(gain, 0, 2, state.gain);
    this._updateAudibleGains();
    return state.gain;
  }

  setTrackPan(trackId, pan) {
    assertTrackId(trackId);
    const state = this._trackStates.get(trackId);
    state.pan = clamp(pan, -1, 1, state.pan);
    const nodes = this._trackNodes.get(trackId);
    if (nodes?.panner?.pan) {
      setAudioParamSmooth(nodes.panner.pan, state.pan, this.context.currentTime);
    }
    return state.pan;
  }

  setTrackMute(trackId, muted) {
    assertTrackId(trackId);
    this._trackStates.get(trackId).muted = Boolean(muted);
    this._updateAudibleGains();
  }

  setTrackSolo(trackId, solo) {
    assertTrackId(trackId);
    this._trackStates.get(trackId).solo = Boolean(solo);
    this._updateAudibleGains();
  }

  clearSolo() {
    for (const state of this._trackStates.values()) state.solo = false;
    this._updateAudibleGains();
  }

  /** Assign a track to a choke group. Empty values clear the assignment. */
  setTrackChokeGroup(trackId, chokeGroup) {
    assertTrackId(trackId);
    const normalized = normalizeChokeGroup(chokeGroup);
    this._trackStates.get(trackId).chokeGroup = normalized;
    return normalized;
  }

  setTrackFilter(trackId, { highpass, lowpass, q } = {}) {
    assertTrackId(trackId);
    const state = this._trackStates.get(trackId);
    if (highpass !== undefined) state.filter.highpass = clamp(highpass, 10, 18000, state.filter.highpass);
    if (lowpass !== undefined) state.filter.lowpass = clamp(lowpass, 40, 24000, state.filter.lowpass);
    if (q !== undefined) state.filter.q = clamp(q, 0.0001, 30, state.filter.q);
    if (state.filter.highpass >= state.filter.lowpass) {
      state.filter.highpass = Math.max(10, state.filter.lowpass - 10);
    }

    const nodes = this._trackNodes.get(trackId);
    if (nodes && this.context) {
      const now = this.context.currentTime;
      setAudioParamSmooth(nodes.highpass.frequency, safeFilterFrequency(nodes.highpass, state.filter.highpass), now);
      setAudioParamSmooth(nodes.lowpass.frequency, safeFilterFrequency(nodes.lowpass, state.filter.lowpass), now);
      setAudioParamSmooth(nodes.highpass.Q, state.filter.q, now);
      setAudioParamSmooth(nodes.lowpass.Q, state.filter.q, now);
    }
    return Object.freeze({ ...state.filter });
  }

  setTrackSend(trackId, { delay, reverb } = {}) {
    assertTrackId(trackId);
    const state = this._trackStates.get(trackId);
    if (delay !== undefined) state.sends.delay = clamp(delay, 0, 1, state.sends.delay);
    if (reverb !== undefined) state.sends.reverb = clamp(reverb, 0, 1, state.sends.reverb);
    const nodes = this._trackNodes.get(trackId);
    if (nodes && this.context) {
      const now = this.context.currentTime;
      setAudioParamSmooth(nodes.delaySend.gain, state.sends.delay, now);
      setAudioParamSmooth(nodes.reverbSend.gain, state.sends.reverb, now);
    }
    return Object.freeze({ ...state.sends });
  }

  setMasterGain(gain) {
    this._masterState.gain = clamp(gain, 0, 2, this._masterState.gain);
    if (this._masterNodes && this.context) {
      setAudioParamSmooth(this._masterNodes.output.gain, this._masterState.gain, this.context.currentTime);
    }
    return this._masterState.gain;
  }

  setMasterEQ({ low, mid, high } = {}) {
    if (low !== undefined) this._masterState.eq.low = clamp(low, -12, 12, this._masterState.eq.low);
    if (mid !== undefined) this._masterState.eq.mid = clamp(mid, -12, 12, this._masterState.eq.mid);
    if (high !== undefined) this._masterState.eq.high = clamp(high, -12, 12, this._masterState.eq.high);

    if (this._masterNodes && this.context) {
      const now = this.context.currentTime;
      setAudioParamSmooth(this._masterNodes.eqLow.gain, this._masterState.eq.low, now);
      setAudioParamSmooth(this._masterNodes.eqMid.gain, this._masterState.eq.mid, now);
      setAudioParamSmooth(this._masterNodes.eqHigh.gain, this._masterState.eq.high, now);
    }
    return Object.freeze({ ...this._masterState.eq });
  }

  setMasterFilter({ highpass, lowpass } = {}) {
    if (highpass !== undefined) this._masterState.filter.highpass = clamp(highpass, 10, 18000, 20);
    if (lowpass !== undefined) this._masterState.filter.lowpass = clamp(lowpass, 40, 24000, 20000);
    if (this._masterState.filter.highpass >= this._masterState.filter.lowpass) {
      this._masterState.filter.highpass = Math.max(10, this._masterState.filter.lowpass - 10);
    }

    if (this._masterNodes && this.context) {
      const now = this.context.currentTime;
      setAudioParamSmooth(this._masterNodes.highpass.frequency, safeFilterFrequency(this._masterNodes.highpass, this._masterState.filter.highpass), now);
      setAudioParamSmooth(this._masterNodes.lowpass.frequency, safeFilterFrequency(this._masterNodes.lowpass, this._masterState.filter.lowpass), now);
    }
    return Object.freeze({ ...this._masterState.filter });
  }

  setCompressor(settings = {}) {
    const state = this._masterState.compressor;
    if (settings.threshold !== undefined) state.threshold = clamp(settings.threshold, -100, 0, state.threshold);
    if (settings.knee !== undefined) state.knee = clamp(settings.knee, 0, 40, state.knee);
    if (settings.ratio !== undefined) state.ratio = clamp(settings.ratio, 1, 20, state.ratio);
    if (settings.attack !== undefined) state.attack = clamp(settings.attack, 0, 1, state.attack);
    if (settings.release !== undefined) state.release = clamp(settings.release, 0, 1, state.release);
    if (this._masterNodes && this.context) this._applyCompressorState(this.context.currentTime);
    return Object.freeze({ ...state });
  }

  setDelay({ time, feedback, wet } = {}) {
    if (time !== undefined) this._delayState.time = clamp(time, 0, 2, this._delayState.time);
    if (feedback !== undefined) this._delayState.feedback = clamp(feedback, 0, 0.92, this._delayState.feedback);
    if (wet !== undefined) this._delayState.wet = clamp(wet, 0, 1, this._delayState.wet);
    if (this._effectNodes && this.context) {
      const now = this.context.currentTime;
      setAudioParamSmooth(this._effectNodes.delay.delayTime, this._delayState.time, now);
      setAudioParamSmooth(this._effectNodes.delayFeedback.gain, this._delayState.feedback, now);
      setAudioParamSmooth(this._effectNodes.delayWet.gain, this._delayState.wet, now);
    }
    return Object.freeze({ ...this._delayState });
  }

  setReverb({ duration, decay, wet, seed } = {}) {
    if (duration !== undefined) this._reverbState.duration = clamp(duration, 0.08, 8, this._reverbState.duration);
    if (decay !== undefined) this._reverbState.decay = clamp(decay, 0.2, 12, this._reverbState.decay);
    if (wet !== undefined) this._reverbState.wet = clamp(wet, 0, 1, this._reverbState.wet);
    if (seed !== undefined && Number.isFinite(Number(seed))) this._reverbState.seed = Number(seed) >>> 0;
    if (this._effectNodes && this.context) {
      this._effectNodes.convolver.buffer = createImpulseResponse(this.context, this._reverbState);
      setAudioParamSmooth(this._effectNodes.reverbWet.gain, this._reverbState.wet, this.context.currentTime);
    }
    return Object.freeze({ ...this._reverbState });
  }

  /**
   * Install a user-provided AudioBuffer as an optional track override.
   * `offset` and `duration` select a region in buffer seconds; `tune` adds a
   * persistent semitone offset. One-shot plays the complete selected region,
   * gate follows each hit duration, and loop repeats the region for that hit.
   * Legacy `loop: true` continues to select loop mode when `mode` is omitted.
   * The native procedural preset remains available through `forceProcedural`.
   */
  setUserBuffer(trackId, audioBuffer, {
    rootMidi = 60,
    tune = 0,
    gain = 1,
    loop = false,
    mode,
    offset = 0,
    duration,
    chokeGroup,
  } = {}) {
    assertTrackId(trackId);
    if (!isAudioBufferLike(audioBuffer)) throw new TypeError('audioBuffer must implement the AudioBuffer interface.');
    const bufferDuration = Math.max(0.005, Number(audioBuffer.duration) || (audioBuffer.length / audioBuffer.sampleRate));
    const safeOffset = clamp(offset, 0, Math.max(0, bufferDuration - 0.001), 0);
    const availableDuration = Math.max(0.001, bufferDuration - safeOffset);
    const regionDuration = Number.isFinite(Number(duration))
      ? clamp(duration, 0.001, availableDuration, availableDuration)
      : availableDuration;
    const playbackMode = normalizeUserBufferMode(mode, loop);
    const entry = Object.freeze({
      buffer: audioBuffer,
      rootMidi: clamp(rootMidi, 0, 127, 60),
      tune: clamp(tune, -48, 48, 0),
      gain: clamp(gain, 0, 4, 1),
      mode: playbackMode,
      loop: playbackMode === 'loop',
      offset: safeOffset,
      duration: regionDuration,
    });
    this._userBuffers.set(trackId, entry);
    if (chokeGroup !== undefined) this.setTrackChokeGroup(trackId, chokeGroup);
    return this.getTrackReadiness(trackId);
  }

  clearUserBuffer(trackId) {
    assertTrackId(trackId);
    return this._userBuffers.delete(trackId);
  }

  clearUserBuffers() {
    this._userBuffers.clear();
  }

  /**
   * Schedule one normalized sequencer step.
   *
   * Supported step fields: active, velocity, accent, ratchet (1-8), nudge or
   * nudgeMs, probability, pitch, midi, frequency, duration, slide, slideTime,
   * presetId, and forceProcedural. `nudge` values are milliseconds.
   */
  scheduleStep(trackId, step = {}, when, { stepDuration = 0.125, presetId } = {}) {
    this._assertReady();
    assertTrackId(trackId);
    const expressive = normalizeExpressiveStep(step);
    if (!expressive.active) {
      return Object.freeze({ scheduled: false, reason: 'inactive', trackId, hits: Object.freeze([]) });
    }
    if (expressive.probability <= 0 || this._random() >= expressive.probability) {
      return Object.freeze({ scheduled: false, reason: 'probability', trackId, hits: Object.freeze([]) });
    }

    const safeStepDuration = clamp(stepDuration, 0.01, 8, 0.125);
    const requestedTime = Number.isFinite(Number(when)) ? Number(when) : this.context.currentTime;
    const baseTime = Math.max(this.context.currentTime, requestedTime + (expressive.nudgeMs / 1000));
    const spacing = safeStepDuration / expressive.ratchet;
    const selectedPreset = resolveAudioPreset(
      trackId,
      expressive.presetId ?? presetId ?? this._trackStates.get(trackId).presetId,
    );
    const hits = [];

    for (let index = 0; index < expressive.ratchet; index += 1) {
      const hitTime = baseTime + (index * spacing);
      const ratchetAttenuation = 1 - (index * 0.045);
      const velocity = clamp(expressive.velocity * expressive.accent * ratchetAttenuation, 0.0001, 1.5, 0.8);
      const gateDuration = expressive.duration ?? Math.max(0.015, spacing * 0.88);
      const voice = this._scheduleVoice(trackId, selectedPreset, expressive, hitTime, gateDuration, velocity);
      hits.push(Object.freeze({ id: voice.id, when: hitTime, velocity, presetId: selectedPreset.id }));
    }

    return Object.freeze({
      scheduled: true,
      reason: null,
      trackId,
      presetId: selectedPreset.id,
      hits: Object.freeze(hits),
    });
  }

  /** Audition a track immediately after initialization. */
  preview(trackId, options = {}) {
    this._assertReady();
    const step = {
      active: true,
      velocity: options.velocity ?? 0.86,
      accent: options.accent ?? false,
      ratchet: options.ratchet ?? 1,
      probability: 1,
      pitch: options.pitch ?? 0,
      midi: options.midi,
      frequency: options.frequency,
      duration: options.duration ?? (trackId === 'amPad' ? 0.8 : 0.22),
      slide: options.slide,
      slideTime: options.slideTime,
      presetId: options.presetId,
      forceProcedural: options.forceProcedural,
    };
    return this.scheduleStep(trackId, step, this.context.currentTime + 0.008, {
      stepDuration: options.stepDuration ?? 0.25,
    });
  }

  /** Schedule a full object-of-track-arrays pattern and return all results. */
  schedulePattern(pattern, {
    startTime,
    stepDuration = 0.125,
    steps,
    swing = 0,
  } = {}) {
    this._assertReady();
    const start = Number.isFinite(Number(startTime)) ? Number(startTime) : this.context.currentTime + 0.01;
    const safeStepDuration = clamp(stepDuration, 0.01, 8, 0.125);
    const inferredLength = Math.max(0, ...TRACK_IDS.map(trackId => (
      Array.isArray(pattern?.[trackId]) ? pattern[trackId].length : 0
    )));
    const length = Math.trunc(clamp(steps ?? inferredLength, 0, 4096, inferredLength));
    const safeSwing = clamp(swing, 0, 75, 0);
    const results = [];

    // Step-major order matches the live transport and keeps cross-track choke
    // groups chronological during an OfflineAudioContext render.
    for (let index = 0; index < length; index += 1) {
      const swingDelay = index % 2 === 1
        ? (safeSwing / 75) * safeStepDuration * 0.5
        : 0;
      for (const trackId of TRACK_IDS) {
        const sequence = pattern?.[trackId];
        if (!Array.isArray(sequence) || index >= sequence.length) continue;
        const entry = typeof sequence[index] === 'boolean'
          ? { active: sequence[index] }
          : sequence[index] ?? { active: false };
        if (entry.active === false) continue;
        results.push(this.scheduleStep(trackId, entry, start + (index * safeStepDuration) + swingDelay, {
          stepDuration: safeStepDuration,
        }));
      }
    }

    return Object.freeze(results);
  }

  /** Stop and release all currently scheduled voices. Idempotent. */
  stop(when) {
    if (!this.context) return 0;
    const stopTime = Number.isFinite(Number(when)) ? Number(when) : this.context.currentTime;
    const immediate = stopTime <= this.context.currentTime + 0.001;
    const voices = [...this._activeVoices.values()];
    for (const voice of voices) {
      voice.sources.forEach(source => safeStop(source, stopTime));
      if (immediate) voice.cleanup();
    }
    this._lastTonalFrequencies.clear();
    return voices.length;
  }

  /** Close the owned AudioContext and release every native node/buffer. */
  async dispose() {
    if (this._disposed) return;
    this.stop();
    this._disposed = true;
    this.status = 'disposed';

    const context = this.context;
    this._disconnectGraph();
    this._activeVoices.clear();
    this._lastTonalFrequencies.clear();
    this._noiseBuffers.clear();
    this._userBuffers.clear();
    this.context = null;
    this._initialization = null;

    for (const state of this._trackStates.values()) state.readiness = 'disposed';
    if (context && context.state !== 'closed' && typeof context.close === 'function') {
      try {
        await context.close();
      } catch {
        // Disposal remains best-effort across browser implementations.
      }
    }
  }

  _assertNotDisposed() {
    if (this._disposed) throw new Error('AudioEngine has been disposed.');
  }

  _assertReady() {
    this._assertNotDisposed();
    if (!this.context || this.status !== 'ready') {
      throw new Error('Call initializeFromGesture() before scheduling audio.');
    }
  }

  _markInitializationError(error) {
    this.status = 'error';
    for (const state of this._trackStates.values()) {
      state.readiness = 'error';
      state.error = serializeError(error);
    }
  }

  _disconnectGraph() {
    for (const nodes of this._trackNodes.values()) {
      Object.values(nodes).forEach(safeDisconnect);
    }
    if (this._effectNodes) Object.values(this._effectNodes).forEach(safeDisconnect);
    if (this._masterNodes) Object.values(this._masterNodes).forEach(safeDisconnect);
    this._trackNodes.clear();
    this._effectNodes = null;
    this._masterNodes = null;
  }

  _buildGraph() {
    const context = this.context;
    const mix = context.createGain();
    const eqLow = context.createBiquadFilter();
    const eqMid = context.createBiquadFilter();
    const eqHigh = context.createBiquadFilter();
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const output = context.createGain();

    setFilter(eqLow, 'lowshelf', 280, 0.7);
    setFilter(eqMid, 'peaking', 1050, 1.05);
    setFilter(eqHigh, 'highshelf', 5200, 0.7);
    setAudioParam(eqLow.gain, this._masterState.eq.low, 0);
    setAudioParam(eqMid.gain, this._masterState.eq.mid, 0);
    setAudioParam(eqHigh.gain, this._masterState.eq.high, 0);
    setFilter(highpass, 'highpass', this._masterState.filter.highpass, 0.7);
    setFilter(lowpass, 'lowpass', this._masterState.filter.lowpass, 0.7);
    setAudioParam(output.gain, this._masterState.gain, 0);
    connectChain(mix, eqLow, eqMid, eqHigh, highpass, lowpass, compressor, output, context.destination);
    this._masterNodes = { mix, eqLow, eqMid, eqHigh, highpass, lowpass, compressor, output };
    this._applyCompressorState(0);

    const delayInput = context.createGain();
    const delay = context.createDelay(2);
    const delayFeedback = context.createGain();
    const delayFilter = context.createBiquadFilter();
    const delayWet = context.createGain();
    setAudioParam(delay.delayTime, this._delayState.time, 0);
    setAudioParam(delayFeedback.gain, this._delayState.feedback, 0);
    setAudioParam(delayWet.gain, this._delayState.wet, 0);
    setFilter(delayFilter, 'lowpass', 5400, 0.65);
    delayInput.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(delayWet);
    delayWet.connect(mix);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delay);

    const reverbInput = context.createGain();
    const convolver = context.createConvolver();
    const reverbWet = context.createGain();
    convolver.buffer = createImpulseResponse(context, this._reverbState);
    setAudioParam(reverbWet.gain, this._reverbState.wet, 0);
    connectChain(reverbInput, convolver, reverbWet, mix);
    this._effectNodes = {
      delayInput,
      delay,
      delayFeedback,
      delayFilter,
      delayWet,
      reverbInput,
      convolver,
      reverbWet,
    };

    for (const trackId of TRACK_IDS) this._buildTrackGraph(trackId);
    this._updateAudibleGains();
  }

  _buildTrackGraph(trackId) {
    const context = this.context;
    const state = this._trackStates.get(trackId);
    const input = context.createGain();
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const panner = typeof context.createStereoPanner === 'function'
      ? context.createStereoPanner()
      : context.createGain();
    const fader = context.createGain();
    const delaySend = context.createGain();
    const reverbSend = context.createGain();

    setFilter(highpass, 'highpass', state.filter.highpass, state.filter.q);
    setFilter(lowpass, 'lowpass', state.filter.lowpass, state.filter.q);
    if (panner.pan) setAudioParam(panner.pan, state.pan, 0);
    setAudioParam(fader.gain, state.gain, 0);
    setAudioParam(delaySend.gain, state.sends.delay, 0);
    setAudioParam(reverbSend.gain, state.sends.reverb, 0);
    connectChain(input, highpass, lowpass, panner, fader, this._masterNodes.mix);
    fader.connect(delaySend);
    delaySend.connect(this._effectNodes.delayInput);
    fader.connect(reverbSend);
    reverbSend.connect(this._effectNodes.reverbInput);
    this._trackNodes.set(trackId, { input, highpass, lowpass, panner, fader, delaySend, reverbSend });
  }

  _applyCompressorState(time) {
    const compressor = this._masterNodes?.compressor;
    if (!compressor) return;
    const state = this._masterState.compressor;
    setAudioParam(compressor.threshold, state.threshold, time);
    setAudioParam(compressor.knee, state.knee, time);
    setAudioParam(compressor.ratio, state.ratio, time);
    setAudioParam(compressor.attack, state.attack, time);
    setAudioParam(compressor.release, state.release, time);
  }

  _effectiveTrackGain(trackId) {
    const state = this._trackStates.get(trackId);
    const anySolo = [...this._trackStates.values()].some(candidate => candidate.solo);
    if (state.muted || (anySolo && !state.solo)) return 0;
    return state.gain;
  }

  _updateAudibleGains() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const trackId of TRACK_IDS) {
      const fader = this._trackNodes.get(trackId)?.fader;
      if (fader) setAudioParamSmooth(fader.gain, this._effectiveTrackGain(trackId), now);
    }
  }

  _scheduleVoice(trackId, preset, expressive, time, duration, velocity) {
    this._chokeVoicesForTrack(trackId, time);
    const userBuffer = expressive.forceProcedural ? null : this._userBuffers.get(trackId);
    if (userBuffer) return this._scheduleBufferVoice(trackId, userBuffer, expressive, time, duration, velocity, preset);

    const voice = preset.params.voice;
    if (voice === 'kick' || voice === 'subKick') {
      return this._scheduleKickVoice(trackId, preset, expressive, time, duration, velocity);
    }
    if (voice === 'snare') return this._scheduleSnareVoice(trackId, preset, expressive, time, duration, velocity);
    if (voice === 'clap') return this._scheduleClapVoice(trackId, preset, expressive, time, duration, velocity);
    if (voice === 'tom') return this._scheduleTomVoice(trackId, preset, expressive, time, duration, velocity);
    if (voice === 'rim' || voice === 'metal') {
      return this._scheduleMetalVoice(trackId, preset, expressive, time, duration, velocity);
    }
    if (voice === 'hat' || voice === 'cymbal' || voice === 'shaker') {
      return this._scheduleNoiseMetalVoice(trackId, preset, expressive, time, duration, velocity);
    }
    return this._scheduleTonalVoice(trackId, preset, expressive, time, duration, velocity);
  }

  _chokeVoicesForTrack(trackId, time) {
    const chokeGroup = this._trackStates.get(trackId)?.chokeGroup;
    if (!chokeGroup) return 0;
    const chokeTime = Math.max(this.context.currentTime, time);
    let count = 0;

    for (const voice of this._activeVoices.values()) {
      const candidateGroup = voice.chokeGroup;
      if (candidateGroup !== chokeGroup || voice.startTime > chokeTime + 0.0001) continue;
      const param = voice.chokeParam;
      if (param) {
        try {
          if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(chokeTime);
          else if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(chokeTime);
          if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(0.00001, chokeTime, 0.003);
          else setAudioParam(param, 0.00001, chokeTime);
        } catch {
          // Source stopping below remains the functional choke fallback.
        }
      }
      voice.sources.forEach(source => safeStop(source, chokeTime + 0.012));
      count += 1;
    }
    return count;
  }

  _createVoiceChain(trackId, params, time, duration, velocity) {
    const context = this.context;
    const bus = context.createGain();
    const amp = context.createGain();
    const nodes = [bus, amp];
    let finalInput = bus;

    if ((params.drive ?? 0) > 0.001 && typeof context.createWaveShaper === 'function') {
      const shaper = context.createWaveShaper();
      shaper.curve = createDriveCurve(params.drive);
      if ('oversample' in shaper) shaper.oversample = '2x';
      bus.connect(shaper);
      shaper.connect(amp);
      nodes.push(shaper);
      finalInput = null;
    }
    if (finalInput) finalInput.connect(amp);
    amp.connect(this._trackNodes.get(trackId).input);

    const endTime = scheduleEnvelope(amp.gain, {
      time,
      attack: params.attack,
      decay: params.decay,
      sustain: params.sustain,
      release: params.release,
      duration,
      peak: velocity,
    });

    return { bus, amp, nodes, endTime };
  }

  _resolveFrequency(params, expressive) {
    if (expressive.frequency !== null) return expressive.frequency;
    if (expressive.midi !== null) return midiToFrequency(expressive.midi);
    return frequencyWithSemitoneOffset(params.frequency, expressive.pitch);
  }

  _scheduleKickVoice(trackId, preset, expressive, time, duration, velocity) {
    const { params } = preset;
    const context = this.context;
    const chain = this._createVoiceChain(trackId, params, time, duration, velocity);
    const oscillator = context.createOscillator();
    const toneFilter = context.createBiquadFilter();
    const baseFrequency = this._resolveFrequency(params, expressive);
    oscillator.type = oscillatorType(params.oscillator, 'sine');
    setFilter(toneFilter, 'lowpass', clamp(params.filterFrequency, 80, 12000, 1800), params.filterQ, time);
    oscillator.connect(toneFilter);
    toneFilter.connect(chain.bus);
    setAudioParam(oscillator.frequency, safeOscillatorFrequency(oscillator, Math.max(20, baseFrequency * (params.pitchSweep ?? 3))), time);
    if (oscillator.frequency.exponentialRampToValueAtTime) {
      oscillator.frequency.exponentialRampToValueAtTime(safeOscillatorFrequency(oscillator, Math.max(20, baseFrequency)), time + Math.min(0.12, params.decay * 0.52));
    }
    oscillator.start(time);
    oscillator.stop(chain.endTime + 0.025);

    const sources = [oscillator];
    const nodes = [...chain.nodes, toneFilter];
    if ((params.noise ?? 0) > 0 || (params.click ?? 0) > 0) {
      const clickSource = context.createBufferSource();
      const clickFilter = context.createBiquadFilter();
      const clickGain = context.createGain();
      clickSource.buffer = this._getNoiseBuffer(0.055, params.seed, 'white');
      setFilter(clickFilter, 'highpass', 2400, 0.8, time);
      setAudioParam(clickGain.gain, clamp((params.noise + params.click) * 0.32, 0, 0.8, 0.1), time);
      clickSource.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(chain.bus);
      clickSource.start(time);
      clickSource.stop(time + 0.055);
      sources.push(clickSource);
      nodes.push(clickFilter, clickGain);
    }
    return this._registerVoice(trackId, sources, nodes, time, chain.endTime, preset.id);
  }

  _scheduleSnareVoice(trackId, preset, expressive, time, duration, velocity) {
    const { params } = preset;
    const context = this.context;
    const chain = this._createVoiceChain(trackId, params, time, duration, velocity);
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = this._getNoiseBuffer(params.decay + params.release + 0.08, params.seed, 'white');
    setFilter(noiseFilter, 'bandpass', params.filterFrequency, Math.max(0.4, params.filterQ), time);
    setAudioParam(noiseGain.gain, clamp(params.noise, 0, 1.3, 0.7), time);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(chain.bus);

    const oscillator = context.createOscillator();
    const oscillatorGain = context.createGain();
    oscillator.type = oscillatorType(params.oscillator, 'triangle');
    setAudioParam(oscillator.frequency, safeOscillatorFrequency(oscillator, this._resolveFrequency(params, expressive)), time);
    setAudioParam(oscillatorGain.gain, clamp(1 - (params.noise * 0.7), 0.08, 0.65, 0.25), time);
    oscillator.connect(oscillatorGain);
    oscillatorGain.connect(chain.bus);
    noise.start(time);
    oscillator.start(time);
    noise.stop(chain.endTime + 0.02);
    oscillator.stop(chain.endTime + 0.02);
    return this._registerVoice(
      trackId,
      [noise, oscillator],
      [...chain.nodes, noiseFilter, noiseGain, oscillatorGain],
      time,
      chain.endTime,
      preset.id,
    );
  }

  _scheduleClapVoice(trackId, preset, expressive, time, duration, velocity) {
    const { params } = preset;
    const context = this.context;
    const chain = this._createVoiceChain(trackId, params, time, duration, velocity);
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const pulseGain = context.createGain();
    noise.buffer = this._getNoiseBuffer(params.decay + params.release + 0.12, params.seed, 'pink');
    setFilter(filter, 'bandpass', params.filterFrequency, Math.max(0.45, params.filterQ), time);
    setAudioParam(pulseGain.gain, 0.00001, time);
    const bursts = Math.trunc(clamp(params.burstCount, 2, 6, 3));
    for (let index = 0; index < bursts; index += 1) {
      const burstTime = time + (index * clamp(params.burstSpacing, 0.008, 0.05, 0.021));
      setAudioParam(pulseGain.gain, Math.max(0.00001, params.noise * (1 - (index * 0.12))), burstTime);
      if (pulseGain.gain.exponentialRampToValueAtTime) {
        pulseGain.gain.exponentialRampToValueAtTime(0.00001, burstTime + 0.012);
      }
    }
    noise.connect(filter);
    filter.connect(pulseGain);
    pulseGain.connect(chain.bus);
    noise.start(time);
    noise.stop(chain.endTime + 0.02);
    return this._registerVoice(trackId, [noise], [...chain.nodes, filter, pulseGain], time, chain.endTime, preset.id);
  }

  _scheduleTomVoice(trackId, preset, expressive, time, duration, velocity) {
    const { params } = preset;
    const context = this.context;
    const chain = this._createVoiceChain(trackId, params, time, duration, velocity);
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    oscillator.type = oscillatorType(params.oscillator, 'sine');
    const frequency = this._resolveFrequency(params, expressive);
    setAudioParam(oscillator.frequency, safeOscillatorFrequency(oscillator, frequency * params.pitchSweep), time);
    if (oscillator.frequency.exponentialRampToValueAtTime) {
      oscillator.frequency.exponentialRampToValueAtTime(safeOscillatorFrequency(oscillator, frequency), time + Math.min(0.11, params.decay * 0.45));
    }
    setFilter(filter, 'lowpass', params.filterFrequency, params.filterQ, time);
    oscillator.connect(filter);
    filter.connect(chain.bus);
    oscillator.start(time);
    oscillator.stop(chain.endTime + 0.02);
    return this._registerVoice(trackId, [oscillator], [...chain.nodes, filter], time, chain.endTime, preset.id);
  }

  _scheduleMetalVoice(trackId, preset, expressive, time, duration, velocity) {
    const { params } = preset;
    const context = this.context;
    const chain = this._createVoiceChain(trackId, params, time, duration, velocity);
    const filter = context.createBiquadFilter();
    setFilter(filter, 'bandpass', params.filterFrequency, params.filterQ, time);
    filter.connect(chain.bus);
    const base = this._resolveFrequency(params, expressive);
    const frequencies = [base, base * (params.harmonicity ?? 1.5)];
    const sources = frequencies.map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = oscillatorType(params.oscillator, 'square');
      setAudioParam(oscillator.frequency, safeOscillatorFrequency(oscillator, frequency), time);
      setAudioParam(gain.gain, index === 0 ? 0.62 : 0.38, time);
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start(time);
      oscillator.stop(chain.endTime + 0.02);
      chain.nodes.push(gain);
      return oscillator;
    });
    return this._registerVoice(trackId, sources, [...chain.nodes, filter], time, chain.endTime, preset.id);
  }

  _scheduleNoiseMetalVoice(trackId, preset, expressive, time, duration, velocity) {
    const { params } = preset;
    const context = this.context;
    const chain = this._createVoiceChain(trackId, params, time, duration, velocity);
    const noise = context.createBufferSource();
    const highpass = context.createBiquadFilter();
    const noiseGain = context.createGain();
    const color = params.voice === 'shaker' ? 'pink' : 'white';
    noise.buffer = this._getNoiseBuffer(params.decay + params.release + 0.12, params.seed, color);
    setFilter(highpass, 'highpass', Math.min(params.filterFrequency, 12000), params.filterQ, time);
    setAudioParam(noiseGain.gain, clamp(params.noise, 0.05, 1.4, 0.7), time);
    noise.connect(highpass);
    highpass.connect(noiseGain);
    noiseGain.connect(chain.bus);
    noise.start(time);
    noise.stop(chain.endTime + 0.02);

    const sources = [noise];
    const nodes = [...chain.nodes, highpass, noiseGain];
    if (params.voice !== 'shaker') {
      const base = this._resolveFrequency(params, expressive);
      [1, params.harmonicity ?? 1.48, (params.harmonicity ?? 1.48) * 1.37].forEach((ratio, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = index === 0 ? 'square' : 'triangle';
        setAudioParam(oscillator.frequency, safeOscillatorFrequency(oscillator, base * ratio), time);
        setAudioParam(gain.gain, 0.11 / (index + 1), time);
        oscillator.connect(gain);
        gain.connect(chain.bus);
        oscillator.start(time);
        oscillator.stop(chain.endTime + 0.02);
        sources.push(oscillator);
        nodes.push(gain);
      });
    }
    return this._registerVoice(trackId, sources, nodes, time, chain.endTime, preset.id);
  }

  _scheduleTonalVoice(trackId, preset, expressive, time, duration, velocity) {
    const { params } = preset;
    const context = this.context;
    const chain = this._createVoiceChain(trackId, params, time, duration, velocity);
    const filter = context.createBiquadFilter();
    setFilter(filter, 'lowpass', params.filterFrequency, params.filterQ, time);
    filter.connect(chain.bus);
    const frequency = this._resolveFrequency(params, expressive);
    const previous = this._lastTonalFrequencies.get(trackId);
    const canSlide = expressive.slide
      && previous
      && previous.time <= time
      && time - previous.time <= 4;
    const slideEnd = Math.min(chain.endTime, time + expressive.slideTime);
    const scheduleFrequency = (oscillator, target, ratio = 1) => {
      const param = oscillator.frequency;
      if (canSlide && typeof param.exponentialRampToValueAtTime === 'function') {
        setAudioParam(param, safeOscillatorFrequency(oscillator, previous.frequency * ratio), time);
        param.exponentialRampToValueAtTime(safeOscillatorFrequency(oscillator, target), slideEnd);
      } else {
        setAudioParam(param, safeOscillatorFrequency(oscillator, target), time);
      }
    };
    const sources = [];
    const nodes = [...chain.nodes, filter];

    if (params.voice === 'fm') {
      const carrier = context.createOscillator();
      const modulator = context.createOscillator();
      const modulationGain = context.createGain();
      carrier.type = oscillatorType(params.oscillator, 'sine');
      modulator.type = 'sine';
      scheduleFrequency(carrier, frequency);
      scheduleFrequency(modulator, frequency * params.harmonicity, params.harmonicity);
      setAudioParam(modulationGain.gain, frequency * params.modulationIndex, time);
      modulator.connect(modulationGain);
      modulationGain.connect(carrier.frequency);
      carrier.connect(filter);
      carrier.start(time);
      modulator.start(time);
      carrier.stop(chain.endTime + 0.025);
      modulator.stop(chain.endTime + 0.025);
      sources.push(carrier, modulator);
      nodes.push(modulationGain);
    } else {
      const spread = params.voice === 'pad' ? Math.max(2, params.spread) : Math.max(0, params.spread ?? 0);
      const detunes = spread > 0 ? [-spread, 0, spread] : [params.detune ?? 0];
      detunes.forEach((detune, index) => {
        const oscillator = context.createOscillator();
        const oscillatorGain = context.createGain();
        oscillator.type = oscillatorType(params.oscillator, 'sawtooth');
        scheduleFrequency(oscillator, frequency);
        setAudioParam(oscillator.detune, detune + (params.detune ?? 0), time);
        setAudioParam(oscillatorGain.gain, 1 / detunes.length, time);
        oscillator.connect(oscillatorGain);
        oscillatorGain.connect(filter);
        oscillator.start(time);
        oscillator.stop(chain.endTime + 0.025);
        sources.push(oscillator);
        nodes.push(oscillatorGain);
        if (params.voice === 'subKick' && index === 0 && oscillator.frequency.exponentialRampToValueAtTime) {
          setAudioParam(oscillator.frequency, safeOscillatorFrequency(oscillator, frequency * (params.pitchSweep ?? 3.2)), time);
          oscillator.frequency.exponentialRampToValueAtTime(safeOscillatorFrequency(oscillator, frequency), time + 0.09);
        }
      });
    }

    if (params.voice === 'acid' && filter.frequency.exponentialRampToValueAtTime) {
      setAudioParam(filter.frequency, safeFilterFrequency(filter, params.filterFrequency * 2.6), time);
      filter.frequency.exponentialRampToValueAtTime(
        safeFilterFrequency(filter, Math.max(60, params.filterFrequency * 0.58)),
        time + Math.max(0.05, params.decay),
      );
    }

    if (params.voice === 'pad' && params.modulationIndex > 0) {
      const lfo = context.createOscillator();
      const lfoGain = context.createGain();
      lfo.type = 'sine';
      setAudioParam(lfo.frequency, Math.max(0.08, params.harmonicity), time);
      setAudioParam(lfoGain.gain, clamp(params.modulationIndex * 0.12, 0.01, 0.35, 0.08), time);
      lfo.connect(lfoGain);
      lfoGain.connect(chain.bus.gain);
      lfo.start(time);
      lfo.stop(chain.endTime + 0.025);
      sources.push(lfo);
      nodes.push(lfoGain);
    }

    if (params.voice === 'pluck' && params.noise > 0) {
      const noise = context.createBufferSource();
      const noiseGain = context.createGain();
      noise.buffer = this._getNoiseBuffer(0.08, params.seed, 'pink');
      setAudioParam(noiseGain.gain, params.noise, time);
      noise.connect(noiseGain);
      noiseGain.connect(filter);
      noise.start(time);
      noise.stop(time + 0.08);
      sources.push(noise);
      nodes.push(noiseGain);
    }

    this._lastTonalFrequencies.set(trackId, { frequency, time });
    return this._registerVoice(trackId, sources, nodes, time, chain.endTime, preset.id);
  }

  _scheduleBufferVoice(trackId, entry, expressive, time, duration, velocity, preset) {
    const context = this.context;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = entry.buffer;
    source.loop = entry.mode === 'loop';
    const semitoneOffset = entry.tune
      + expressive.pitch
      + (expressive.midi !== null ? expressive.midi - entry.rootMidi : 0);
    const playbackRate = 2 ** (semitoneOffset / 12);
    setAudioParam(source.playbackRate, playbackRate, time);
    source.connect(gain);
    gain.connect(this._trackNodes.get(trackId).input);
    const bufferDuration = Math.max(0.005, Number(entry.buffer.duration) || duration);
    const startOffset = Math.min(entry.offset, Math.max(0, bufferDuration - 0.001));
    const regionDuration = Math.min(entry.duration, Math.max(0.001, bufferDuration - startOffset));
    const regionPlaybackDuration = Math.max(0.005, regionDuration / playbackRate);
    const hitDuration = Math.max(0.005, expressive.duration ?? duration);
    const gate = entry.mode === 'one-shot' ? regionPlaybackDuration : hitDuration;
    const endTime = scheduleEnvelope(gain.gain, {
      time,
      attack: 0.002,
      decay: 0.015,
      sustain: 1,
      release: 0.025,
      duration: gate,
      peak: velocity * entry.gain,
    });
    if (entry.mode === 'loop') {
      source.loopStart = startOffset;
      source.loopEnd = startOffset + regionDuration;
      source.start(time, startOffset);
      source.stop(endTime + 0.02);
    } else {
      source.start(time, startOffset, regionDuration);
      const naturalEnd = time + regionPlaybackDuration;
      source.stop(entry.mode === 'one-shot'
        ? naturalEnd + 0.01
        : Math.min(endTime + 0.02, naturalEnd + 0.01));
    }
    return this._registerVoice(trackId, [source], [gain], time, endTime, `${preset.id}:user-buffer`);
  }

  _getNoiseBuffer(duration, seed, color) {
    const roundedDuration = Math.ceil(clamp(duration, 0.01, 8, 0.2) * 100) / 100;
    const key = `${seed}:${color}:${roundedDuration}`;
    if (!this._noiseBuffers.has(key)) {
      this._noiseBuffers.set(key, createNoiseBuffer(this.context, {
        duration: roundedDuration,
        seed,
        color,
      }));
    }
    return this._noiseBuffers.get(key);
  }

  _registerVoice(trackId, sources, nodes, startTime, endTime, presetId) {
    const id = this._nextVoiceId;
    this._nextVoiceId += 1;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      sources.forEach(safeDisconnect);
      nodes.forEach(safeDisconnect);
      this._activeVoices.delete(id);
    };
    const chokeParam = nodes[1]?.gain ?? nodes[0]?.gain ?? null;
    const voice = {
      id,
      trackId,
      presetId,
      sources,
      nodes,
      startTime,
      endTime,
      chokeGroup: this._trackStates.get(trackId)?.chokeGroup ?? '',
      chokeParam,
      cleanup,
    };
    this._activeVoices.set(id, voice);
    if (sources[0]) {
      const previous = sources[0].onended;
      sources[0].onended = event => {
        if (typeof previous === 'function') previous.call(sources[0], event);
        cleanup();
      };
    }
    return voice;
  }
}

/** Maximum render length used to keep accidental offline exports bounded. */
export const OFFLINE_RENDER_MAX_SECONDS = 180;

function inferPatternLength(pattern) {
  return Math.max(0, ...TRACK_IDS.map(trackId => (
    Array.isArray(pattern?.[trackId]) ? pattern[trackId].length : 0
  )));
}

function createOfflineContext({ numberOfChannels, length, sampleRate }, contextFactory) {
  if (contextFactory !== undefined) {
    if (typeof contextFactory !== 'function') {
      throw new TypeError('offlineContextFactory must be a function.');
    }
    const context = contextFactory({ numberOfChannels, length, sampleRate });
    if (context && typeof context.then === 'function') {
      throw new TypeError('offlineContextFactory must return an OfflineAudioContext synchronously.');
    }
    return context;
  }

  const Context = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (typeof Context !== 'function') {
    const error = new Error('OfflineAudioContext is not supported in this environment.');
    error.name = 'NotSupportedError';
    throw error;
  }

  try {
    return new Context({ numberOfChannels, length, sampleRate });
  } catch {
    // Legacy WebKit only supports the positional constructor.
    return new Context(numberOfChannels, length, sampleRate);
  }
}

function applyOfflineTrackSettings(engine, trackSettings) {
  if (!trackSettings || typeof trackSettings !== 'object') return;
  for (const trackId of TRACK_IDS) {
    const settings = trackSettings[trackId];
    if (!settings || typeof settings !== 'object') continue;
    if (settings.presetId !== undefined) engine.setTrackPreset(trackId, settings.presetId);
    if (settings.gain !== undefined) engine.setTrackGain(trackId, settings.gain);
    if (settings.pan !== undefined) engine.setTrackPan(trackId, settings.pan);
    if (settings.muted !== undefined) engine.setTrackMute(trackId, settings.muted);
    if (settings.solo !== undefined) engine.setTrackSolo(trackId, settings.solo);
    if (settings.chokeGroup !== undefined) engine.setTrackChokeGroup(trackId, settings.chokeGroup);
    if (settings.filter) engine.setTrackFilter(trackId, settings.filter);
    if (settings.sends) engine.setTrackSend(trackId, settings.sends);
    if (settings.audioBuffer) {
      engine.setUserBuffer(trackId, settings.audioBuffer, settings.bufferOptions);
    }
  }
}

function applyOfflineMasterSettings(engine, masterSettings, effects) {
  if (masterSettings && typeof masterSettings === 'object') {
    if (masterSettings.gain !== undefined) engine.setMasterGain(masterSettings.gain);
    if (masterSettings.eq) engine.setMasterEQ(masterSettings.eq);
    if (masterSettings.filter) engine.setMasterFilter(masterSettings.filter);
    if (masterSettings.compressor) engine.setCompressor(masterSettings.compressor);
  }
  if (effects && typeof effects === 'object') {
    if (effects.delay) engine.setDelay(effects.delay);
    if (effects.reverb) engine.setReverb(effects.reverb);
  }
}

/**
 * Render a real, dependency-free DM99 mix into an AudioBuffer.
 *
 * Browser globals are resolved only when this function is called. The common
 * options are `tempo`, `bars`, `sampleRate`, `kitId`, and `trackSettings`;
 * `masterSettings`, `effects`, `tailSeconds`, `stepsPerBeat`, `swing`, `random`, and
 * `randomSeed` allow export parity with a configured live engine. `offlineContextFactory`
 * exists for Web Audio polyfills and deterministic tests.
 */
export async function renderPatternOffline(pattern, {
  tempo = 120,
  bars,
  sampleRate = 44100,
  kitId = DEFAULT_KIT_ID,
  trackSettings,
  masterSettings,
  effects,
  tailSeconds = 3,
  stepsPerBeat = 4,
  swing = 0,
  random,
  randomSeed = 0x444d3939,
  offlineContextFactory,
} = {}) {
  const safeTempo = clamp(tempo, 20, 400, 120);
  const safeSampleRate = Math.trunc(clamp(sampleRate, 8000, 96000, 44100));
  const subdivisions = Math.trunc(clamp(stepsPerBeat, 1, 16, 4));
  const inferredSteps = inferPatternLength(pattern);
  const requestedSteps = bars === undefined
    ? (inferredSteps || (4 * subdivisions))
    : Math.ceil(clamp(bars, 0.25, 256, 1) * 4 * subdivisions);
  const steps = Math.trunc(clamp(requestedSteps, 1, 4096, 4 * subdivisions));
  const stepDuration = 60 / safeTempo / subdivisions;
  const safeTail = clamp(tailSeconds, 0.05, 12, 3);
  const renderSeconds = (steps * stepDuration) + safeTail;

  if (renderSeconds > OFFLINE_RENDER_MAX_SECONDS) {
    throw new RangeError(`Offline render exceeds the ${OFFLINE_RENDER_MAX_SECONDS}-second safety limit.`);
  }

  const numberOfChannels = 2;
  const length = Math.max(1, Math.ceil(renderSeconds * safeSampleRate));
  const context = createOfflineContext(
    { numberOfChannels, length, sampleRate: safeSampleRate },
    offlineContextFactory,
  );
  if (!context || typeof context.createGain !== 'function' || typeof context.startRendering !== 'function') {
    throw new TypeError('offlineContextFactory did not return an OfflineAudioContext-compatible object.');
  }

  const engine = new AudioEngine({
    contextFactory: () => context,
    initialKit: kitId,
    sampleRate: safeSampleRate,
    random: typeof random === 'function' ? random : createSeededRandom(randomSeed),
  });
  engine.context = context;
  engine.status = 'initializing';

  try {
    applyOfflineTrackSettings(engine, trackSettings);
    engine._buildGraph();
    engine.status = 'ready';
    for (const state of engine._trackStates.values()) {
      state.readiness = 'ready';
      state.error = null;
    }
    applyOfflineMasterSettings(engine, masterSettings, effects);
    engine.schedulePattern(pattern, { startTime: 0, stepDuration, steps, swing });
    const rendered = await context.startRendering();
    if (!isAudioBufferLike(rendered)) {
      throw new TypeError('OfflineAudioContext.startRendering() did not return an AudioBuffer.');
    }
    return rendered;
  } finally {
    await engine.dispose();
  }
}

/** Convenience factory; like the constructor, it does not create audio nodes. */
export function createAudioEngine(options) {
  return new AudioEngine(options);
}

/** Re-export registry constants commonly needed by integration code. */
export { AUDIO_PRESET_REGISTRY, DEFAULT_KIT_ID, KIT_SNAPSHOTS, TRACK_IDS, TRACK_REGISTRY };

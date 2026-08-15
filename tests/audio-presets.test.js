import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUDIO_PRESET_REGISTRY,
  DEFAULT_KIT_ID,
  KIT_NAMES,
  KIT_SNAPSHOTS,
  PRESET_IDS_BY_TRACK,
  SAMPLE_STYLE_TRACK_IDS,
  SYNTH_TRACK_IDS,
  TRACK_IDS,
  TRACK_REGISTRY,
  getAudioPreset,
  getKitSnapshot,
  listAudioPresets,
  resolveAudioPreset,
  validateInstrumentRegistry,
} from '../src/instruments.js';
import {
  AudioEngine,
  OFFLINE_RENDER_MAX_SECONDS,
  USER_BUFFER_MODES,
  renderPatternOffline,
} from '../src/audio-engine.js';
import { normalizeExpressiveStep } from '../src/audio-dsp.js';

const EXPECTED_TRACK_IDS = [
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
];

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  record(type, value, time, extra) {
    this.value = value;
    this.events.push({ type, value, time, extra });
  }

  setValueAtTime(value, time) { this.record('set', value, time); }

  setTargetAtTime(value, time, constant) { this.record('target', value, time, constant); }

  linearRampToValueAtTime(value, time) { this.record('linear', value, time); }

  exponentialRampToValueAtTime(value, time) { this.record('exponential', value, time); }

  cancelScheduledValues(time) { this.events.push({ type: 'cancel', time }); }
}

class FakeAudioNode {
  constructor(context) {
    this.context = context;
    this.connections = [];
    this.disconnected = false;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnected = true;
    this.connections.length = 0;
  }
}

class FakeGainNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.gain = new FakeAudioParam(1);
  }
}

class FakeFilterNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
    this.gain = new FakeAudioParam(0);
    this.type = 'lowpass';
  }
}

class FakeCompressorNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.threshold = new FakeAudioParam(-24);
    this.knee = new FakeAudioParam(30);
    this.ratio = new FakeAudioParam(12);
    this.attack = new FakeAudioParam(0.003);
    this.release = new FakeAudioParam(0.25);
  }
}

class FakeSourceNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.started = [];
    this.stopped = [];
    this.onended = null;
    context.sources.push(this);
  }

  start(...args) { this.started.push(args); }

  stop(...args) { this.stopped.push(args); }
}

class FakeOscillatorNode extends FakeSourceNode {
  constructor(context) {
    super(context);
    this.frequency = new FakeAudioParam(440);
    this.detune = new FakeAudioParam(0);
    this.type = 'sine';
  }
}

class FakeBufferSourceNode extends FakeSourceNode {
  constructor(context) {
    super(context);
    this.buffer = null;
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.playbackRate = new FakeAudioParam(1);
  }
}

class FakeAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(channel) { return this.channels[channel]; }
}

class FakeAudioContext {
  constructor({ sampleRate = 8000, length = sampleRate * 4, offline = false } = {}) {
    this.sampleRate = sampleRate;
    this.length = length;
    this.currentTime = 0;
    this.state = offline ? 'running' : 'suspended';
    this.destination = new FakeAudioNode(this);
    this.sources = [];
    this.filters = [];
    this.offline = offline;
    this.resumeCalls = 0;
  }

  createGain() { return new FakeGainNode(this); }

  createBiquadFilter() {
    const filter = new FakeFilterNode(this);
    this.filters.push(filter);
    return filter;
  }

  createDynamicsCompressor() { return new FakeCompressorNode(this); }

  createDelay() {
    const node = new FakeAudioNode(this);
    node.delayTime = new FakeAudioParam(0);
    return node;
  }

  createConvolver() {
    const node = new FakeAudioNode(this);
    node.buffer = null;
    return node;
  }

  createStereoPanner() {
    const node = new FakeAudioNode(this);
    node.pan = new FakeAudioParam(0);
    return node;
  }

  createWaveShaper() {
    const node = new FakeAudioNode(this);
    node.curve = null;
    node.oversample = 'none';
    return node;
  }

  createOscillator() { return new FakeOscillatorNode(this); }

  createBufferSource() { return new FakeBufferSourceNode(this); }

  createBuffer(channels, length, sampleRate) {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }

  async resume() {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  async suspend() { this.state = 'suspended'; }

  async close() { this.state = 'closed'; }

  async startRendering() {
    assert.equal(this.offline, true);
    const output = new FakeAudioBuffer(2, this.length, this.sampleRate);
    if (this.sources.some(source => source.started.length > 0)) {
      output.getChannelData(0)[0] = 0.25;
    }
    this.state = 'closed';
    return output;
  }
}

test('registry preserves the exact 26-track DM99 contract', () => {
  assert.deepEqual(TRACK_IDS, EXPECTED_TRACK_IDS);
  assert.equal(SAMPLE_STYLE_TRACK_IDS.length, 21);
  assert.equal(SYNTH_TRACK_IDS.length, 5);
  assert.deepEqual([...SAMPLE_STYLE_TRACK_IDS, ...SYNTH_TRACK_IDS], EXPECTED_TRACK_IDS);
  assert.equal(new Set(TRACK_IDS).size, 26);
  assert.deepEqual(Object.keys(TRACK_REGISTRY), EXPECTED_TRACK_IDS);
});

test('124 offline procedural presets meet per-track minima and metadata invariants', () => {
  const audit = validateInstrumentRegistry();
  assert.equal(audit.valid, true, audit.errors.join('\n'));
  assert.deepEqual(audit.counts, {
    tracks: 26,
    sampleStyleTracks: 21,
    synthTracks: 5,
    presets: 124,
    kits: 8,
  });
  assert.equal(Object.keys(AUDIO_PRESET_REGISTRY).length, 124);

  for (const trackId of TRACK_IDS) {
    const presets = listAudioPresets(trackId);
    const minimum = SYNTH_TRACK_IDS.includes(trackId) ? 8 : 4;
    assert.ok(presets.length >= minimum, `${trackId} needs ${minimum} presets`);
    assert.equal(presets.length, PRESET_IDS_BY_TRACK[trackId].length);
    assert.ok(Object.isFrozen(PRESET_IDS_BY_TRACK[trackId]));

    for (const preset of presets) {
      assert.equal(preset.trackId, trackId);
      assert.equal(preset.params.voice, TRACK_REGISTRY[trackId].voice);
      assert.equal(preset.kind, 'procedural');
      assert.equal(preset.engine, 'native-web-audio');
      assert.equal(preset.provenance, 'DM99-generated');
      assert.equal(preset.networkRequired, false);
      assert.equal(preset.guaranteedFallback, true);
      assert.ok(preset.tags.includes('offline'));
      assert.ok(Object.isFrozen(preset));
      assert.ok(Object.isFrozen(preset.params));
      assert.ok(Object.isFrozen(preset.tags));
    }
  }
});

test('no two presets have the same audible parameter payload, even without seed', () => {
  const signatures = new Map();
  for (const preset of Object.values(AUDIO_PRESET_REGISTRY)) {
    const params = { ...preset.params };
    delete params.seed;
    const signature = JSON.stringify(params, Object.keys(params).sort());
    assert.equal(signatures.has(signature), false, `${preset.id} duplicates ${signatures.get(signature)}`);
    signatures.set(signature, preset.id);
  }
});

test('all eight named kit snapshots select a valid preset for every track', () => {
  assert.equal(DEFAULT_KIT_ID, 'techno');
  assert.deepEqual(KIT_NAMES, [
    'Techno',
    'Deep House',
    'Electro',
    'Trance',
    'DnB',
    'Industrial',
    'Acid',
    'Ambient',
  ]);
  assert.deepEqual(Object.values(KIT_SNAPSHOTS).map(kit => kit.name), KIT_NAMES);

  for (const kit of Object.values(KIT_SNAPSHOTS)) {
    assert.equal(kit.provenance, 'DM99-generated');
    assert.equal(kit.networkRequired, false);
    assert.equal(kit.guaranteedFallback, true);
    assert.deepEqual(Object.keys(kit.presets), TRACK_IDS);
    for (const trackId of TRACK_IDS) {
      assert.equal(getAudioPreset(kit.presets[trackId]).trackId, trackId);
    }
  }
  assert.equal(getKitSnapshot('Deep House'), KIT_SNAPSHOTS['deep-house']);
});

test('preset resolution is track-safe and always falls back locally', () => {
  const fallback = resolveAudioPreset('kick', 'does-not-exist');
  assert.equal(fallback.id, TRACK_REGISTRY.kick.fallbackPresetId);
  assert.equal(resolveAudioPreset('kick', 'sub-techno'), fallback);
  assert.equal(fallback.provenance, 'DM99-generated');
  assert.equal(fallback.networkRequired, false);
  assert.throws(() => resolveAudioPreset('missing-track', 'kick-tight'), RangeError);
});

test('audio source modules contain no remote/provider runtime path', () => {
  const sources = [
    '../src/instruments.js',
    '../src/audio-dsp.js',
    '../src/audio-engine.js',
  ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

  const forbidden = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /https?:\/\//,
    /\bTone\b/,
    /\bNexus\b/,
    /\bimport\s+[^;]+\s+from\s+['"](?!\.)/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(sources, pattern);
});

test('constructing AudioEngine is browser-global-safe and lazy', async () => {
  let contextCreations = 0;
  const engine = new AudioEngine({
    contextFactory() {
      contextCreations += 1;
      throw new Error('must not run during construction');
    },
  });
  assert.equal(contextCreations, 0);
  assert.equal(engine.context, null);
  assert.equal(engine.status, 'idle');
  assert.equal(Object.keys(engine.getReadinessSnapshot()).length, 26);
  assert.ok(Object.values(engine.getReadinessSnapshot()).every(item => item.state === 'idle'));

  const userBuffer = new FakeAudioBuffer(1, 8000, 8000);
  assert.equal(engine.setUserBuffer('kick', userBuffer).source, 'user-buffer');
  assert.equal(engine.getTrackReadiness('kick').guaranteedFallback, true);
  assert.equal(engine.clearUserBuffer('kick'), true);
  await engine.dispose();
  assert.equal(contextCreations, 0);
});

test('expressive steps normalize velocity, accent, ratchet, nudge, and probability', () => {
  assert.deepEqual(normalizeExpressiveStep({
    velocity: 2,
    accent: true,
    probability: -1,
    ratchet: 12,
    nudge: -999,
    pitch: 99,
    midi: 45,
    duration: 0,
    slide: true,
    slideTime: 9,
  }), {
    active: true,
    velocity: 1,
    accent: 1.22,
    probability: 0,
    ratchet: 8,
    nudgeMs: -250,
    pitch: 48,
    midi: 45,
    frequency: null,
    duration: 0.005,
    slide: true,
    slideTime: 0.5,
    presetId: null,
    forceProcedural: false,
  });
});

test('user-buffer modes, tune, choke groups, swing, and tonal slide are audible scheduling controls', async () => {
  assert.deepEqual(USER_BUFFER_MODES, ['one-shot', 'gate', 'loop']);
  const context = new FakeAudioContext();
  const engine = new AudioEngine({ contextFactory: () => context, random: () => 0 });
  await engine.initializeFromGesture();
  const buffer = new FakeAudioBuffer(1, 16000, 8000);

  engine.setUserBuffer('kick', buffer, {
    mode: 'one-shot',
    offset: 0.5,
    duration: 1,
    tune: 12,
  });
  assert.equal(engine.getTrackReadiness('kick').bufferMode, 'one-shot');
  let before = context.sources.length;
  engine.scheduleStep('kick', { probability: 1, duration: 0.1 }, 1);
  const oneShot = context.sources.slice(before).find(source => source instanceof FakeBufferSourceNode);
  assert.deepEqual(oneShot.started[0], [1, 0.5, 1]);
  assert.equal(oneShot.playbackRate.value, 2);
  assert.ok(Math.abs(oneShot.stopped[0][0] - 1.51) < 0.0001);

  engine.setUserBuffer('snare', buffer, { mode: 'gate', duration: 1 });
  before = context.sources.length;
  engine.scheduleStep('snare', { probability: 1 }, 2, { stepDuration: 0.2 });
  const gated = context.sources.slice(before).find(source => source instanceof FakeBufferSourceNode);
  assert.equal(gated.loop, false);
  assert.deepEqual(gated.started[0], [2, 0, 1]);
  assert.ok(gated.stopped[0][0] > 2.17 && gated.stopped[0][0] < 2.23);

  engine.setUserBuffer('clap', buffer, { mode: 'loop', offset: 0.25, duration: 0.5 });
  before = context.sources.length;
  engine.scheduleStep('clap', { probability: 1, duration: 0.12 }, 3);
  const looped = context.sources.slice(before).find(source => source instanceof FakeBufferSourceNode);
  assert.equal(looped.loop, true);
  assert.equal(looped.loopStart, 0.25);
  assert.equal(looped.loopEnd, 0.75);
  assert.deepEqual(looped.started[0], [3, 0.25]);
  assert.ok(looped.stopped[0][0] > 3.14 && looped.stopped[0][0] < 3.18);

  assert.equal(engine.setTrackChokeGroup('kick', 'drums'), 'drums');
  assert.equal(engine.setTrackChokeGroup('snare', 'drums'), 'drums');
  before = context.sources.length;
  engine.scheduleStep('kick', { probability: 1 }, 4);
  const choked = context.sources.slice(before).find(source => source instanceof FakeBufferSourceNode);
  engine.scheduleStep('snare', { probability: 1 }, 4.1);
  assert.ok(choked.stopped.some(([time]) => Math.abs(time - 4.112) < 0.0001));

  engine.clearUserBuffers();
  engine.setTrackChokeGroup('kick', '');
  const swung = engine.schedulePattern({ kick: [true, true, true] }, {
    startTime: 5,
    stepDuration: 0.2,
    steps: 3,
    swing: 75,
  });
  assert.deepEqual(swung.map(result => Number(result.hits[0].when.toFixed(3))), [5, 5.3, 5.4]);

  before = context.sources.length;
  engine.scheduleStep('bass1', { probability: 1, pitch: 0 }, 6);
  engine.scheduleStep('bass1', { probability: 1, pitch: 12, slide: true }, 6.25);
  const tonalOscillators = context.sources.slice(before).filter(source => source instanceof FakeOscillatorNode);
  assert.equal(tonalOscillators.length, 2);
  const slideEvents = tonalOscillators[1].frequency.events;
  const slideStart = slideEvents.find(event => event.type === 'set');
  const slideEnd = slideEvents.find(event => event.type === 'exponential');
  assert.ok(slideStart.value > 54 && slideStart.value < 56);
  assert.ok(slideEnd.value > 109 && slideEnd.value < 111);
  assert.ok(Math.abs(slideEnd.time - 6.31) < 0.0001);

  await engine.dispose();
});

test('live engine creates one graph on gesture and schedules expressive native voices', async () => {
  let contextCreations = 0;
  const context = new FakeAudioContext();
  const engine = new AudioEngine({
    contextFactory: () => {
      contextCreations += 1;
      return context;
    },
    random: () => 0.2,
  });

  const firstInitialization = engine.initializeFromGesture();
  const concurrentInitialization = engine.initializeFromGesture();
  const [firstReadiness] = await Promise.all([firstInitialization, concurrentInitialization]);
  await engine.initializeFromGesture();
  assert.equal(contextCreations, 1);
  assert.equal(context.resumeCalls, 1);
  assert.equal(engine.status, 'ready');
  assert.ok(Object.values(firstReadiness).every(item => item.ready));

  engine.setTrackGain('kick', 0.64);
  engine.setTrackPan('kick', -0.25);
  engine.setTrackFilter('kick', { highpass: 28, lowpass: 9000, q: 1.2 });
  engine.setTrackSend('kick', { delay: 0.2, reverb: 0.15 });
  engine.setMasterEQ({ low: 2, mid: -1, high: 1 });
  engine.setCompressor({ ratio: 4 });
  engine.setDelay({ time: 0.18, feedback: 0.3, wet: 0.2 });
  engine.setReverb({ duration: 0.1, decay: 1.2, wet: 0.1 });

  const result = engine.scheduleStep('kick', {
    velocity: 0.75,
    accent: true,
    probability: 1,
    ratchet: 3,
    nudgeMs: -10,
  }, 1, { stepDuration: 0.12 });
  assert.equal(result.scheduled, true);
  assert.equal(result.hits.length, 3);
  assert.deepEqual(result.hits.map(hit => Number(hit.when.toFixed(3))), [0.99, 1.03, 1.07]);
  assert.ok(context.sources.some(source => source instanceof FakeOscillatorNode));

  const skipped = engine.scheduleStep('snare', { probability: 0.1 }, 1.5);
  assert.equal(skipped.scheduled, false);
  assert.equal(skipped.reason, 'probability');
  const impossible = engine.scheduleStep('snare', { probability: 0 }, 1.5);
  assert.equal(impossible.scheduled, false);

  const userBuffer = new FakeAudioBuffer(1, 16000, 8000);
  engine.setUserBuffer('kick', userBuffer, { offset: 1.5 });
  const before = context.sources.length;
  engine.scheduleStep('kick', { probability: 1, duration: 0.1 }, 2);
  const bufferSources = context.sources.slice(before).filter(source => source instanceof FakeBufferSourceNode);
  assert.equal(bufferSources.length, 1);
  assert.equal(bufferSources[0].started[0][1], 1.5);

  assert.ok(engine.stop() > 0);
  await engine.dispose();
  assert.equal(context.state, 'closed');
  assert.equal(engine.status, 'disposed');
});

test('offline renderer schedules the real graph and returns an AudioBuffer-like mix', async () => {
  let receivedOptions;
  let context;
  let randomCalls = 0;
  const rendered = await renderPatternOffline({
    kick: [true, true, false, false],
    snare: [false, false, true, false],
    amPad: [{ active: true, midi: 48, velocity: 0.4 }],
  }, {
    tempo: 120,
    bars: 1,
    sampleRate: 8000,
    tailSeconds: 0.1,
    swing: 75,
    random: () => {
      randomCalls += 1;
      return 0;
    },
    kitId: 'ambient',
    trackSettings: {
      kick: { gain: 0.7, pan: -0.1, sends: { reverb: 0.2 } },
    },
    offlineContextFactory(options) {
      receivedOptions = options;
      context = new FakeAudioContext({ ...options, offline: true });
      return context;
    },
  });

  assert.deepEqual(receivedOptions, {
    numberOfChannels: 2,
    length: 16800,
    sampleRate: 8000,
  });
  assert.equal(rendered.numberOfChannels, 2);
  assert.equal(rendered.length, 16800);
  assert.equal(rendered.sampleRate, 8000);
  assert.notEqual(rendered.getChannelData(0)[0], 0);
  assert.ok(context.sources.filter(source => source.started.length).length >= 3);
  assert.ok(context.sources.some(source => source.started.some(([time]) => Math.abs(time - 0.1875) < 0.0001)));
  assert.ok(randomCalls >= 3);
  const scheduledFilterFrequencies = context.filters.flatMap(filter => (
    filter.frequency.events.filter(event => Number.isFinite(event.value)).map(event => event.value)
  ));
  assert.ok(scheduledFilterFrequencies.length > 0);
  assert.ok(scheduledFilterFrequencies.every(value => value <= 3600));
  const scheduledOscillatorFrequencies = context.sources
    .filter(source => source instanceof FakeOscillatorNode)
    .flatMap(source => source.frequency.events.filter(event => Number.isFinite(event.value)).map(event => event.value));
  assert.ok(scheduledOscillatorFrequencies.length > 0);
  assert.ok(scheduledOscillatorFrequencies.every(value => value <= 3600));
});

test('offline renderer fails gracefully when unsupported and bounds huge renders', async () => {
  if (!globalThis.OfflineAudioContext && !globalThis.webkitOfflineAudioContext) {
    await assert.rejects(
      renderPatternOffline({ kick: [true] }),
      error => error.name === 'NotSupportedError' && /not supported/i.test(error.message),
    );
  }
  assert.equal(OFFLINE_RENDER_MAX_SECONDS, 180);
  await assert.rejects(
    renderPatternOffline({}, {
      tempo: 20,
      bars: 256,
      offlineContextFactory: () => new FakeAudioContext({ offline: true }),
    }),
    /safety limit/,
  );
});

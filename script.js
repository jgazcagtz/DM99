// ═══════════════════════════════════════════════════════════════════
//  DM99 v2.0 — Config-Driven Drum Machine & Step Sequencer
// ═══════════════════════════════════════════════════════════════════

const SEQUENCE_LENGTH = 32;

const SOUND_BASE = 'https://sampleswap.org/samples';
const sounds = Object.freeze({
    kick: `${SOUND_BASE}/DRUMS/kick-techno-120.wav`,
    snare: `${SOUND_BASE}/DRUMS/snare-acid-023.wav`,
    hihatClosed: `${SOUND_BASE}/DRUMS/hihat-closed-techno-012.wav`,
    hihatOpened: `${SOUND_BASE}/DRUMS/hihat-open-015.wav`,
    clap: `${SOUND_BASE}/DRUMS/clap-techno-008.wav`,
    bass1: `${SOUND_BASE}/BASS/acid-bass-128.wav`,
    tom: `${SOUND_BASE}/DRUMS/tom-mid-034.wav`,
    perc1: `${SOUND_BASE}/PERC/shaker-techno-019.wav`,
    perc2: `${SOUND_BASE}/PERC/cowbell-techno-003.wav`,
    perc3: `${SOUND_BASE}/PERC/ride-techno-011.wav`,
    acid: `${SOUND_BASE}/SYNTH/acid-line-138.wav`,
    synth: `${SOUND_BASE}/SYNTH/stab-techno-025.wav`,
    crash: `${SOUND_BASE}/DRUMS/crash-techno-007.wav`,
    ride: `${SOUND_BASE}/DRUMS/ride-techno-011.wav`,
});
const REMOTE_SAMPLE_LIBRARY_ENABLED = new URLSearchParams(window.location.search).get('remoteSamples') === '1';

// ============= INSTRUMENT CONFIGURATION =============
const INSTRUMENTS = [
    // --- Drums ---
    { id: 'kick', label: 'Kick', group: 'Drums', volume: 0.8, mono: true,
      url: sounds.kick,
      adsr: { attack: 0.01, decay: 0.3, sustain: 0.0, release: 0.2 } },
    { id: 'snare', label: 'Snare', group: 'Drums', volume: 0.7,
      url: sounds.snare },
    { id: 'clap', label: 'Clap', group: 'Drums', volume: 0.7,
      url: sounds.clap },
    { id: 'tom', label: 'Tom', group: 'Drums', volume: 0.7,
      url: sounds.tom },
    { id: 'rimshot', label: 'Rim', group: 'Drums', volume: 0.65,
      url: sounds.snare },
    { id: 'cowbell', label: 'Cow', group: 'Drums', volume: 0.55,
      url: sounds.perc2 },
    // --- Cymbals ---
    { id: 'hihatClosed', label: 'HHC', group: 'Cymbals', volume: 0.6,
      url: sounds.hihatClosed,
      adsr: { attack: 0.005, decay: 0.15, sustain: 0.0, release: 0.1 } },
    { id: 'hihatOpened', label: 'HHO', group: 'Cymbals', volume: 0.6,
      url: sounds.hihatOpened },
    { id: 'crash', label: 'Crash', group: 'Cymbals', volume: 0.45,
      url: sounds.crash },
    { id: 'ride', label: 'Ride', group: 'Cymbals', volume: 0.45,
      url: sounds.ride },
    // --- Percussion ---
    { id: 'perc1', label: 'Perc1', group: 'Perc', volume: 0.6,
      url: sounds.perc1 },
    { id: 'perc2', label: 'Perc2', group: 'Perc', volume: 0.6,
      url: sounds.perc2 },
    { id: 'perc3', label: 'Perc3', group: 'Perc', volume: 0.6,
      url: sounds.perc3 },
    { id: 'perc4', label: 'Perc4', group: 'Perc', volume: 0.6,
      url: sounds.perc1 },
    { id: 'perc5', label: 'Perc5', group: 'Perc', volume: 0.6,
      url: sounds.perc2 },
    { id: 'perc6', label: 'Perc6', group: 'Perc', volume: 0.6,
      url: sounds.perc3 },
    { id: 'shaker', label: 'Shak', group: 'Perc', volume: 0.5,
      url: sounds.perc1 },
    { id: 'tamb', label: 'Tamb', group: 'Perc', volume: 0.5,
      url: sounds.perc1 },
    // --- Tonal (sample-based, pitched) ---
    { id: 'bass1', label: 'Bass', group: 'Tonal', volume: 0.5, mono: true, pitched: true,
      url: sounds.bass1,
      adsr: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 } },
    { id: 'acid', label: 'Acid', group: 'Tonal', volume: 0.6, pitched: true,
      url: sounds.acid,
      adsr: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2 } },
    { id: 'synth', label: 'Synth', group: 'Tonal', volume: 0.6, pitched: true,
      url: sounds.synth,
      adsr: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.5 } },
    // --- Synth (Tone.js powered, pitched) ---
    { id: 'sub', label: 'Sub', group: 'Synth', volume: 0.6, pitched: true,
      tone: { type: 'Synth', options: { oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.5, sustain: 0.8, release: 0.3 } } },
      adsr: { attack: 0.01, decay: 0.5, sustain: 0.8, release: 0.3 } },
    { id: 'tr808', label: '808', group: 'Synth', volume: 0.6, pitched: true,
      tone: { type: 'MembraneSynth', options: { pitchDecay: 0.05, octaves: 4, envelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.1 } } },
      adsr: { attack: 0.001, decay: 0.8, sustain: 0.0, release: 0.1 } },
    { id: 'fmBass', label: 'FM', group: 'Synth', volume: 0.5, pitched: true,
      tone: { type: 'FMSynth', options: { harmonicity: 3, modulationIndex: 10, envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 } } },
      adsr: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 } },
    { id: 'pluck', label: 'Pluck', group: 'Synth', volume: 0.5, pitched: true,
      tone: { type: 'PluckSynth', options: { attackNoise: 1, dampening: 4000, resonance: 0.9 } } },
    { id: 'amPad', label: 'AM', group: 'Synth', volume: 0.5, pitched: true,
      tone: { type: 'AMSynth', options: { harmonicity: 2, envelope: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 } } },
      adsr: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 } },
];

// Build lookup map
const INSTRUMENT_MAP = {};
INSTRUMENTS.forEach(inst => { INSTRUMENT_MAP[inst.id] = inst; });

// ============= SCALES =============
const SCALES = {
    minor:    [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
};
function getScalePitches(scale) { return SCALES[scale] || SCALES.minor; }

// ============= AUDIO ENGINE =============
const toneContext = typeof Tone !== 'undefined' && typeof Tone.getContext === 'function'
    ? Tone.getContext()
    : null;
const audioCtx = toneContext?.rawContext || new (window.AudioContext || window.webkitAudioContext)();

// Master compressor
const masterCompressor = audioCtx.createDynamicsCompressor();
masterCompressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
masterCompressor.knee.setValueAtTime(30, audioCtx.currentTime);
masterCompressor.ratio.setValueAtTime(12, audioCtx.currentTime);
masterCompressor.attack.setValueAtTime(0, audioCtx.currentTime);
masterCompressor.release.setValueAtTime(0.25, audioCtx.currentTime);

// Master gain
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.8;

// Master filters
const masterLowpass = audioCtx.createBiquadFilter();
masterLowpass.type = 'lowpass'; masterLowpass.frequency.value = 20000;
const masterHighpass = audioCtx.createBiquadFilter();
masterHighpass.type = 'highpass'; masterHighpass.frequency.value = 20;

// Master EQ
const eqFilters = {
    low:  Object.assign(audioCtx.createBiquadFilter(), { type: 'lowshelf' }),
    mid:  Object.assign(audioCtx.createBiquadFilter(), { type: 'peaking' }),
    high: Object.assign(audioCtx.createBiquadFilter(), { type: 'highshelf' }),
};
eqFilters.low.frequency.value = 320;
eqFilters.mid.frequency.value = 1000; eqFilters.mid.Q.value = 1;
eqFilters.high.frequency.value = 3200;

// Bass/Synth EQ
const bassEqFilters = {
    low:  Object.assign(audioCtx.createBiquadFilter(), { type: 'lowshelf' }),
    mid:  Object.assign(audioCtx.createBiquadFilter(), { type: 'peaking' }),
    high: Object.assign(audioCtx.createBiquadFilter(), { type: 'highshelf' }),
};
bassEqFilters.low.frequency.value = 80;
bassEqFilters.mid.frequency.value = 500; bassEqFilters.mid.Q.value = 1;
bassEqFilters.high.frequency.value = 2000;

// Master chain: masterGain → EQ → HP → LP → Compressor → Destination
masterGain.connect(eqFilters.low);
eqFilters.low.connect(eqFilters.mid);
eqFilters.mid.connect(eqFilters.high);
eqFilters.high.connect(masterHighpass);
masterHighpass.connect(masterLowpass);
masterLowpass.connect(masterCompressor);
masterCompressor.connect(audioCtx.destination);

// Bass EQ chain connected ONCE: bassLow → bassMid → bassHigh → masterGain
bassEqFilters.low.connect(bassEqFilters.mid);
bassEqFilters.mid.connect(bassEqFilters.high);
bassEqFilters.high.connect(masterGain);

// Per-instrument gain nodes
const instrumentGainNodes = {};
INSTRUMENTS.forEach(inst => {
    const gn = audioCtx.createGain();
    gn.gain.value = inst.volume;
    // Route pitched/tone instruments through bass EQ, others direct to master
    gn.connect((inst.pitched || inst.tone) ? bassEqFilters.low : masterGain);
    instrumentGainNodes[inst.id] = gn;
});

// ============= TONE.JS SYNTH ENGINE =============
const toneInstruments = {};
let toneInitialized = false;
function initToneJS() {
    if (toneInitialized) return;
    if (typeof Tone === 'undefined') { console.warn('Tone.js not loaded'); return; }
    INSTRUMENTS.filter(i => i.tone).forEach(inst => {
        try {
            const ToneClass = Tone[inst.tone.type];
            if (!ToneClass) return;
            const synth = new ToneClass(inst.tone.options || {});
            synth.disconnect();
            synth.connect(instrumentGainNodes[inst.id]);
            toneInstruments[inst.id] = synth;
        } catch(e) { console.warn(`Tone.js ${inst.tone.type} failed:`, e); }
    });
    toneInitialized = true;
}

// ============= STATE =============
let currentInstrument = 'kick';
let isPlaying = false;
let currentStep = 0;
let previousStep = -1;
let tempo = 120;
let swing = 0;
let swingOffset = 0;
let timerID = null;
let nextNoteTime = 0;
let cachedPads = [];
let activeKnobs = [];

// Sequences — normalized: every instrument uses { active, pitch, scale }
const sequences = {};
INSTRUMENTS.forEach(inst => {
    sequences[inst.id] = Array.from({ length: SEQUENCE_LENGTH }, () => ({ active: false, pitch: 0, scale: 'minor' }));
});

// Mute / Solo / Volume / ADSR — derived from config
const mutedInstruments = {};
const soloedInstruments = {};
const instrumentVolumes = {};
const adsrParams = {};
INSTRUMENTS.forEach(inst => {
    mutedInstruments[inst.id] = false;
    soloedInstruments[inst.id] = false;
    instrumentVolumes[inst.id] = inst.volume;
    if (inst.adsr) adsrParams[inst.id] = { ...inst.adsr };
});

// Audio buffers (for sample-based instruments)
const buffers = {};
const sampleSources = {};

// ============= SOUND LOADING =============
function createSeededNoise(seedText) {
    let state = Array.from(seedText).reduce((seed, char) => ((seed * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return (state / 2147483648) - 1;
    };
}

function createProceduralSample(instrumentId) {
    const durationById = {
        kick: 0.55, snare: 0.38, clap: 0.32, tom: 0.5, rimshot: 0.18, cowbell: 0.42,
        hihatClosed: 0.12, hihatOpened: 0.55, crash: 1.5, ride: 1.1,
        bass1: 0.9, acid: 0.7, synth: 0.8
    };
    const duration = durationById[instrumentId] || 0.38;
    const frameCount = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
    const audioBuffer = audioCtx.createBuffer(1, frameCount, audioCtx.sampleRate);
    const channel = audioBuffer.getChannelData(0);
    const noise = createSeededNoise(instrumentId);
    let noisePrevious = 0;
    let phase = 0;
    let peak = 0;

    for (let frame = 0; frame < frameCount; frame++) {
        const time = frame / audioCtx.sampleRate;
        const random = noise();
        const brightNoise = random - noisePrevious * 0.82;
        noisePrevious = random;
        let value = 0;

        if (instrumentId === 'kick') {
            const frequency = 46 + (118 * Math.exp(-time * 34));
            phase += (Math.PI * 2 * frequency) / audioCtx.sampleRate;
            value = Math.sin(phase) * Math.exp(-time * 8.5) + random * 0.08 * Math.exp(-time * 45);
        } else if (instrumentId === 'snare') {
            value = brightNoise * 0.72 * Math.exp(-time * 13) + Math.sin(Math.PI * 2 * 185 * time) * 0.26 * Math.exp(-time * 18);
        } else if (instrumentId === 'clap') {
            const burst = [0, 0.022, 0.044].reduce((sum, start) => sum + (time >= start ? Math.exp(-(time - start) * 70) : 0), 0);
            value = brightNoise * Math.min(1, burst) * 0.72 * Math.exp(-time * 4);
        } else if (instrumentId === 'tom') {
            const frequency = 105 + 55 * Math.exp(-time * 20);
            phase += (Math.PI * 2 * frequency) / audioCtx.sampleRate;
            value = Math.sin(phase) * 0.85 * Math.exp(-time * 7);
        } else if (instrumentId === 'rimshot') {
            value = (Math.sin(Math.PI * 2 * 610 * time) + Math.sin(Math.PI * 2 * 940 * time)) * 0.34 * Math.exp(-time * 32);
        } else if (instrumentId === 'cowbell' || instrumentId === 'perc2' || instrumentId === 'perc5') {
            value = (Math.sin(Math.PI * 2 * 540 * time) + Math.sin(Math.PI * 2 * 845 * time) * 0.7) * 0.48 * Math.exp(-time * 8);
        } else if (instrumentId === 'hihatClosed' || instrumentId === 'shaker' || instrumentId === 'perc1') {
            value = brightNoise * 0.55 * Math.exp(-time * (instrumentId === 'hihatClosed' ? 38 : 16));
        } else if (instrumentId === 'hihatOpened' || instrumentId === 'crash' || instrumentId === 'ride' || instrumentId === 'perc3') {
            const decay = instrumentId === 'hihatOpened' ? 8 : 2.8;
            const metallic = Math.sin(Math.PI * 2 * 4217 * time) * Math.sin(Math.PI * 2 * 6329 * time);
            value = (brightNoise * 0.38 + metallic * 0.17) * Math.exp(-time * decay);
        } else if (instrumentId === 'bass1' || instrumentId === 'acid' || instrumentId === 'synth') {
            const baseFrequency = instrumentId === 'synth' ? 110 : 55;
            phase += (Math.PI * 2 * baseFrequency) / audioCtx.sampleRate;
            const sine = Math.sin(phase);
            const saw = 2 * ((phase / (Math.PI * 2)) % 1) - 1;
            const blend = instrumentId === 'bass1' ? sine : (sine * 0.35 + saw * 0.65);
            value = blend * 0.7 * Math.exp(-time * (instrumentId === 'synth' ? 2.6 : 3.8));
        } else if (instrumentId === 'tamb') {
            const metallic = Math.sin(Math.PI * 2 * 5100 * time) * Math.sin(Math.PI * 2 * 7900 * time);
            value = (brightNoise * 0.42 + metallic * 0.2) * Math.exp(-time * 10);
        } else {
            const toneFrequency = 180 + (instrumentId.charCodeAt(instrumentId.length - 1) || 0) * 3;
            value = (brightNoise * 0.38 + Math.sin(Math.PI * 2 * toneFrequency * time) * 0.4) * Math.exp(-time * 12);
        }

        channel[frame] = value;
        peak = Math.max(peak, Math.abs(value));
    }

    if (peak > 0.92) {
        const scale = 0.92 / peak;
        for (let frame = 0; frame < frameCount; frame++) channel[frame] *= scale;
    }

    return audioBuffer;
}

async function fetchRemoteSample(url, retryCount = 1) {
    let lastError;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) {
                throw new Error(`Unexpected content type: ${contentType || 'unknown'}`);
            }
            return await audioCtx.decodeAudioData(await response.arrayBuffer());
        } catch (error) {
            lastError = error;
            const shouldRetry = attempt < retryCount && (!error.status || error.status >= 500);
            if (!shouldRetry) break;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    throw lastError;
}

function convertBufferToMono(audioBuffer) {
    if (audioBuffer.numberOfChannels <= 1) return audioBuffer;
    const monoBuffer = audioCtx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
    const monoData = monoBuffer.getChannelData(0);

    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex++) {
        const source = audioBuffer.getChannelData(channelIndex);
        for (let frame = 0; frame < audioBuffer.length; frame++) {
            monoData[frame] += source[frame] / audioBuffer.numberOfChannels;
        }
    }

    return monoBuffer;
}

async function loadSounds() {
    const sampleInstruments = INSTRUMENTS.filter(i => i.url);
    let loaded = 0;
    let remoteLoaded = 0;
    const total = sampleInstruments.length;
    const progressEl = document.getElementById('loader-progress');
    const textEl = document.getElementById('loader-text');
    const remoteLoads = new Map();

    if (!REMOTE_SAMPLE_LIBRARY_ENABLED) {
        sampleInstruments.forEach(inst => {
            buffers[inst.id] = createProceduralSample(inst.id);
            sampleSources[inst.id] = 'procedural';
        });
        if (progressEl) progressEl.style.width = '100%';
        if (textEl) textEl.textContent = `Audio ready — ${total} built-in instruments loaded`;
        console.warn('Remote SampleSwap loading is disabled because the supplied paths are not browser-loadable. Using built-in Web Audio instruments.');
        return;
    }

    await Promise.all(sampleInstruments.map(async inst => {
        try {
            textEl.textContent = `Loading ${inst.label}...`;

            if (!remoteLoads.has(inst.url)) remoteLoads.set(inst.url, fetchRemoteSample(inst.url));
            const decoded = await remoteLoads.get(inst.url);
            buffers[inst.id] = inst.mono ? convertBufferToMono(decoded) : decoded;
            sampleSources[inst.id] = 'remote';
            remoteLoaded++;
        } catch (err) {
            buffers[inst.id] = createProceduralSample(inst.id);
            sampleSources[inst.id] = 'procedural';
            console.warn(`SampleSwap ${inst.label} unavailable (${err.message}); using the built-in Web Audio fallback.`);
        }
        loaded++;
        if (progressEl) progressEl.style.width = `${(loaded / total) * 100}%`;
    }));

    if (textEl) {
        const fallbackCount = total - remoteLoaded;
        textEl.textContent = fallbackCount > 0
            ? `Audio ready — ${fallbackCount} built-in fallback${fallbackCount === 1 ? '' : 's'} active`
            : `Audio ready — ${remoteLoaded} samples loaded`;
    }
}

// ============= PLAY SOUND (sample-based, with cleanup) =============
function playSound(buffer, time, playbackRate, duration, instrumentId, adsr) {
    if (!buffer) return null;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gainNode = audioCtx.createGain();
    if (adsr) {
        gainNode.gain.setValueAtTime(0, time);
        gainNode.gain.linearRampToValueAtTime(1, time + adsr.attack);
        gainNode.gain.linearRampToValueAtTime(adsr.sustain, time + adsr.attack + adsr.decay);
        if (duration) {
            gainNode.gain.setValueAtTime(adsr.sustain, time + duration);
            gainNode.gain.linearRampToValueAtTime(0, time + duration + adsr.release);
        }
    } else {
        gainNode.gain.setValueAtTime(1, time);
    }

    source.connect(gainNode);
    gainNode.connect(instrumentGainNodes[instrumentId]);
    source.start(time);
    if (duration) source.stop(time + duration + (adsr ? adsr.release : 0));

    // FIX: Clean up audio nodes to prevent memory leak
    source.onended = () => { source.disconnect(); gainNode.disconnect(); };
    return source;
}

// ============= PLAY TONE.JS NOTE =============
function playToneNote(instConfig, time, pitch) {
    const synth = toneInstruments[instConfig.id];
    if (!synth) return;
    const adsr = adsrParams[instConfig.id];
    const baseFreq = 41.2; // E1
    const freq = Math.max(20, baseFreq * Math.pow(2, (pitch - 12) / 12));

    // Sync ADSR sliders to Tone.js envelope
    if (adsr && synth.envelope) {
        try {
            synth.envelope.attack = adsr.attack;
            synth.envelope.decay = adsr.decay;
            synth.envelope.sustain = adsr.sustain;
            synth.envelope.release = adsr.release;
        } catch(e) {}
    }

    const dur = adsr ? Math.max(adsr.attack + adsr.decay + 0.05, 0.1) : 0.2;
    try { synth.triggerAttackRelease(freq, dur, time); } catch(e) {}
}

// ============= SCHEDULER =============
function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + 0.1) {
        scheduleNote(currentStep, nextNoteTime);
        advanceStep();
    }
    timerID = setTimeout(scheduler, 25);
}

function advanceStep() {
    const secondsPerBeat = 60.0 / tempo;
    nextNoteTime += 0.25 * secondsPerBeat;
    currentStep = (currentStep + 1) % SEQUENCE_LENGTH;
}

function scheduleNote(step, time) {
    // FIX: Only toggle previous and current pad (no DOM thrashing)
    if (cachedPads.length > 0) {
        if (previousStep >= 0 && previousStep < cachedPads.length)
            cachedPads[previousStep].classList.remove('playing');
        if (step < cachedPads.length)
            cachedPads[step].classList.add('playing');
        previousStep = step;
    }

    // Swing: offset odd steps
    let adjustedTime = time;
    if (step % 2 === 1) adjustedTime += swingOffset;

    const isAnySoloed = Object.values(soloedInstruments).some(v => v);

    INSTRUMENTS.forEach(inst => {
        if (mutedInstruments[inst.id]) return;
        if (isAnySoloed && !soloedInstruments[inst.id]) return;

        const s = sequences[inst.id][step];
        if (!s.active) return;

        const adsr = adsrParams[inst.id] || null;

        if (inst.tone) {
            playToneNote(inst, adjustedTime, s.pitch);
        } else if (inst.pitched) {
            const rate = Math.pow(2, (s.pitch - 12) / 12);
            playSound(buffers[inst.id], adjustedTime, rate, null, inst.id, adsr);
        } else {
            playSound(buffers[inst.id], adjustedTime, 1, null, inst.id, adsr);
        }
    });
}

// ============= TRANSPORT =============
async function startPlaying() {
    if (isPlaying) return;
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (typeof Tone !== 'undefined' && typeof Tone.start === 'function') {
        try { await Tone.start(); } catch (error) { console.warn('Tone.js could not start:', error); }
    }
    initToneJS();
    isPlaying = true;
    currentStep = 0;
    previousStep = -1;
    nextNoteTime = audioCtx.currentTime + 0.05;
    scheduler();
    document.getElementById('play').classList.add('active-play');
}

function stopPlaying() {
    if (!isPlaying) return;
    isPlaying = false;
    clearTimeout(timerID);
    cachedPads.forEach(p => p.classList.remove('playing'));
    previousStep = -1;
    document.getElementById('play').classList.remove('active-play');
}

// ============= GAIN NODE UPDATES =============
function updateGainNodes() {
    const isAnySoloed = Object.values(soloedInstruments).some(v => v);
    INSTRUMENTS.forEach(inst => {
        const id = inst.id;
        if (isAnySoloed) {
            instrumentGainNodes[id].gain.value = soloedInstruments[id] ? instrumentVolumes[id] : 0;
        } else {
            instrumentGainNodes[id].gain.value = mutedInstruments[id] ? 0 : instrumentVolumes[id];
        }
    });
}

// ============= UI: GENERATE INSTRUMENT PANEL =============
function generateInstrumentPanel() {
    const panel = document.getElementById('instrument-panel');
    panel.innerHTML = '';

    // Group instruments
    const groups = {};
    INSTRUMENTS.forEach(inst => {
        if (!groups[inst.group]) groups[inst.group] = [];
        groups[inst.group].push(inst);
    });

    Object.entries(groups).forEach(([groupName, instruments]) => {
        const label = document.createElement('div');
        label.className = 'inst-group-label';
        label.textContent = groupName;
        panel.appendChild(label);

        const row = document.createElement('div');
        row.className = 'inst-group-row';

        instruments.forEach(inst => {
            const container = document.createElement('div');
            container.className = 'instrument-container';

            // Instrument select button
            const btn = document.createElement('button');
            btn.className = 'instrument-button';
            btn.dataset.instrument = inst.id;
            btn.textContent = inst.label;
            if (inst.id === currentInstrument) btn.classList.add('active');
            btn.addEventListener('click', () => {
                document.querySelectorAll('.instrument-button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentInstrument = inst.id;
                generatePads();
            });

            // Solo button
            const solo = document.createElement('button');
            solo.className = 'solo-button';
            solo.textContent = '🔊';
            solo.addEventListener('click', () => {
                soloedInstruments[inst.id] = !soloedInstruments[inst.id];
                solo.classList.toggle('active', soloedInstruments[inst.id]);
                updateGainNodes();
            });

            // Volume slider
            const vol = document.createElement('input');
            vol.type = 'range'; vol.className = 'volume-slider';
            vol.min = '0'; vol.max = '1'; vol.step = '0.01'; vol.value = inst.volume;
            vol.addEventListener('input', () => {
                instrumentVolumes[inst.id] = parseFloat(vol.value);
                instrumentGainNodes[inst.id].gain.value = instrumentVolumes[inst.id];
                updateGainNodes();
            });

            // Mute button
            const mute = document.createElement('button');
            mute.className = 'mute-button';
            mute.textContent = '🔇';
            mute.addEventListener('click', () => {
                mutedInstruments[inst.id] = !mutedInstruments[inst.id];
                mute.classList.toggle('muted', mutedInstruments[inst.id]);
                updateGainNodes();
            });

            container.append(btn, solo, vol, mute);
            row.appendChild(container);
        });
        panel.appendChild(row);
    });
}

// ============= UI: GENERATE PADS =============
function generatePads() {
    // Destroy old NexusUI knobs
    activeKnobs.forEach(k => { try { k.destroy(); } catch(e) {} });
    activeKnobs = [];

    const dm = document.getElementById('drum-machine');
    dm.innerHTML = '';

    const config = INSTRUMENT_MAP[currentInstrument];
    const isPitched = !!config.pitched;

    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
        const pad = document.createElement('div');
        pad.classList.add('pad');
        pad.dataset.step = i + 1;
        pad.dataset.index = i;

        const step = sequences[currentInstrument][i];
        if (step.active) pad.classList.add('active');

        if (isPitched) {
            const knobContainer = document.createElement('div');
            knobContainer.classList.add('pitch-knob');
            pad.appendChild(knobContainer);

            const scalePitches = getScalePitches(step.scale || 'minor');
            const pitchIndex = Math.max(0, scalePitches.indexOf(step.pitch));

            // Defer Nexus.Dial creation
            const idx = i;
            setTimeout(() => {
                try {
                    const knob = new Nexus.Dial(knobContainer, {
                        size: [34, 34], min: 0, max: scalePitches.length - 1,
                        step: 1, value: pitchIndex
                    });
                    knob.on('change', v => {
                        sequences[currentInstrument][idx].pitch = scalePitches[Math.round(v)];
                    });
                    knob.colorize('fill', '#00e676');
                    knob.colorize('accent', '#00e676');
                    activeKnobs.push(knob);
                } catch(e) {}
            }, 0);

            knobContainer.style.display = step.active ? 'block' : 'none';

            pad.addEventListener('click', (e) => {
                if (e.target.closest('.pitch-knob')) return; // Don't toggle when clicking knob
                step.active = !step.active;
                pad.classList.toggle('active', step.active);
                knobContainer.style.display = step.active ? 'block' : 'none';
            });
        } else {
            pad.addEventListener('click', () => {
                step.active = !step.active;
                pad.classList.toggle('active', step.active);
            });
        }

        dm.appendChild(pad);
    }

    // Cache pad references for scheduler
    cachedPads = Array.from(dm.querySelectorAll('.pad'));
}

// ============= UI: GENERATE ADSR CONTROLS =============
function generateADSR() {
    const content = document.getElementById('adsr-content');
    content.innerHTML = '';

    const adsrInstruments = INSTRUMENTS.filter(i => i.adsr);
    adsrInstruments.forEach(inst => {
        const div = document.createElement('div');
        div.className = 'adsr-instrument';

        const h4 = document.createElement('h4');
        h4.textContent = inst.label;
        div.appendChild(h4);

        ['attack', 'decay', 'sustain', 'release'].forEach(param => {
            const label = document.createElement('label');
            label.textContent = param.charAt(0).toUpperCase() + param.slice(1);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'adsr-slider';
            slider.min = '0';
            slider.max = param === 'decay' || param === 'release' ? '2' : '1';
            slider.step = '0.01';
            slider.value = adsrParams[inst.id] ? adsrParams[inst.id][param] : 0.1;

            slider.addEventListener('input', () => {
                if (!adsrParams[inst.id]) adsrParams[inst.id] = { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 };
                adsrParams[inst.id][param] = parseFloat(slider.value);
            });

            label.appendChild(slider);
            div.appendChild(label);
        });

        content.appendChild(div);
    });
}

// ============= RANDOM PATTERN GENERATOR =============
const RHYTHM_PATTERNS = [
    [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
    [1,0,1,0,0,1,0,0,1,0,1,0,0,1,0,0],
    [0,1,0,1,0,0,1,0,1,0,0,1,0,1,0,0],
    [1,0,0,1,0,0,0,1,0,0,1,0,0,0,1,0],
    [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1],
    [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
    [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1],
    [1,0,1,0,1,0,0,1,0,1,0,1,0,1,0,0],
];

function generateRandomSequence(instrumentId) {
    const inst = INSTRUMENT_MAP[instrumentId];
    const rhythm = RHYTHM_PATTERNS[Math.floor(Math.random() * RHYTHM_PATTERNS.length)];
    const scales = ['minor', 'phrygian'];
    const selectedScale = scales[Math.floor(Math.random() * scales.length)];
    const scalePitches = getScalePitches(selectedScale);

    const pattern = rhythm.map((hit, i) => ({
        active: !!hit,
        pitch: hit ? (i === 0 ? 0 : scalePitches[Math.floor(Math.random() * scalePitches.length)]) : 0,
        scale: selectedScale
    }));

    // Repeat to fill 32 steps
    sequences[instrumentId] = [...pattern, ...pattern];
    if (currentInstrument === instrumentId) generatePads();
}

// ============= AI PATTERN GENERATION =============
const AI_DRUM_IDS = [
    'kick', 'snare', 'hihatClosed', 'hihatOpened', 'clap',
    'tom', 'perc1', 'perc2', 'perc3', 'crash', 'ride'
];
const SERVER_PATTERN_IDS = [
    'kick', 'snare', 'hihatClosed', 'hihatOpened', 'clap',
    'tom', 'perc1', 'perc2', 'perc3'
];
const SUPPORTED_AI_GENRES = new Set(['techno', 'house', 'trance', 'dnb']);

function clampEnergy(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.7;
}

function createBooleanDrumPattern(steps = SEQUENCE_LENGTH) {
    const safeSteps = Math.max(1, Math.min(SEQUENCE_LENGTH, Math.trunc(Number(steps)) || SEQUENCE_LENGTH));
    return Object.fromEntries(AI_DRUM_IDS.map(id => [id, Array(safeSteps).fill(false)]));
}

function addPatternHit(pattern, instrumentId, step) {
    if (pattern[instrumentId] && Number.isInteger(step) && step >= 0 && step < pattern[instrumentId].length) {
        pattern[instrumentId][step] = true;
    }
}

function addPatternHits(pattern, instrumentId, steps) {
    steps.forEach(step => addPatternHit(pattern, instrumentId, step));
}

function addEvery(pattern, instrumentId, start, interval) {
    for (let step = start; step < pattern[instrumentId].length; step += interval) {
        addPatternHit(pattern, instrumentId, step);
    }
}

// Deterministic offline fallback. Each energy tier adds hits without removing the groove.
function generateRuleBasedPattern(genre = 'techno', steps = SEQUENCE_LENGTH, energy = 0.7) {
    const selectedGenre = SUPPORTED_AI_GENRES.has(genre) ? genre : 'techno';
    const selectedEnergy = clampEnergy(energy);
    const pattern = createBooleanDrumPattern(steps);

    for (let bar = 0; bar < pattern.kick.length; bar += 16) {
        const at = offset => bar + offset;

        if (selectedGenre === 'dnb') {
            addPatternHits(pattern, 'kick', [at(0), at(6), at(10)]);
            addPatternHits(pattern, 'snare', [at(4), at(12)]);
            if (selectedEnergy >= 0.25) addEvery(pattern, 'hihatClosed', at(0), 2);
            if (selectedEnergy >= 0.5) addPatternHits(pattern, 'kick', [at(15)]);
            if (selectedEnergy >= 0.65) addPatternHits(pattern, 'perc1', [at(3), at(11)]);
            if (selectedEnergy >= 0.8) addPatternHits(pattern, 'hihatOpened', [at(7), at(15)]);
            if (selectedEnergy >= 0.9) addPatternHits(pattern, 'tom', [at(13), at(14), at(15)]);
            continue;
        }

        addPatternHits(pattern, 'kick', [at(0), at(4), at(8), at(12)]);

        if (selectedGenre === 'house') {
            addPatternHits(pattern, 'snare', [at(4), at(12)]);
            addPatternHits(pattern, 'clap', [at(4), at(12)]);
            addPatternHits(pattern, 'hihatClosed', [at(2), at(6), at(10), at(14)]);
            if (selectedEnergy >= 0.45) addEvery(pattern, 'hihatClosed', at(0), 2);
            if (selectedEnergy >= 0.65) addPatternHits(pattern, 'hihatOpened', [at(6), at(14)]);
            if (selectedEnergy >= 0.8) addPatternHits(pattern, 'perc1', [at(3), at(11)]);
            if (selectedEnergy >= 0.95) addPatternHits(pattern, 'perc2', [at(7), at(15)]);
        } else if (selectedGenre === 'trance') {
            addPatternHits(pattern, 'snare', [at(4), at(12)]);
            if (selectedEnergy >= 0.2) addPatternHits(pattern, 'hihatClosed', [at(2), at(6), at(10), at(14)]);
            if (selectedEnergy >= 0.45) addEvery(pattern, 'hihatClosed', at(1), 2);
            if (selectedEnergy >= 0.65) addPatternHits(pattern, 'clap', [at(4), at(12)]);
            if (selectedEnergy >= 0.75) addPatternHits(pattern, 'hihatOpened', [at(6), at(14)]);
            if (selectedEnergy >= 0.9) addPatternHits(pattern, 'perc3', [at(3), at(7), at(11), at(15)]);
        } else {
            addPatternHits(pattern, 'snare', [at(4), at(12)]);
            if (selectedEnergy >= 0.2) addPatternHits(pattern, 'hihatClosed', [at(2), at(6), at(10), at(14)]);
            if (selectedEnergy >= 0.45) addEvery(pattern, 'hihatClosed', at(1), 2);
            if (selectedEnergy >= 0.6) addPatternHits(pattern, 'clap', [at(4), at(12)]);
            if (selectedEnergy >= 0.7) addPatternHits(pattern, 'hihatOpened', [at(6), at(14)]);
            if (selectedEnergy >= 0.85) addPatternHits(pattern, 'perc1', [at(3), at(11)]);
            if (selectedEnergy >= 0.95) addPatternHits(pattern, 'tom', [at(13), at(14), at(15)]);
        }
    }

    return pattern;
}

function applyBooleanPattern(pattern) {
    let hitCount = 0;

    AI_DRUM_IDS.forEach(instrumentId => {
        if (!Array.isArray(pattern?.[instrumentId]) || !sequences[instrumentId]) return;

        sequences[instrumentId] = sequences[instrumentId].map((step, index) => {
            const active = pattern[instrumentId][index] === true;
            if (active) hitCount++;
            return { ...step, active };
        });
    });

    generatePads();
    return hitCount;
}

function generateBassSequence(genre, energy) {
    const selectedGenre = SUPPORTED_AI_GENRES.has(genre) ? genre : 'techno';
    const selectedEnergy = clampEnergy(energy);
    const scale = selectedGenre === 'dnb' ? 'phrygian' : 'minor';
    const scalePitches = getScalePitches(scale);
    const patterns = {
        techno: [[0, 0], [6, 3], [8, 0], [14, 5]],
        house: [[0, 0], [3, 2], [6, 4], [8, 0], [11, 2], [14, 5]],
        trance: [[0, 0], [2, 4], [4, 5], [6, 4], [8, 0], [10, 4], [12, 5], [14, 6]],
        dnb: [[0, 0], [5, 3], [7, 0], [10, 5], [13, 1]]
    };
    const base = patterns[selectedGenre];
    const allowedHits = selectedEnergy < 0.35
        ? base.filter((_, index) => index % 2 === 0)
        : selectedEnergy < 0.75
            ? base
            : [...base, [15, 2]];
    const byStep = new Map();

    for (let bar = 0; bar < SEQUENCE_LENGTH; bar += 16) {
        allowedHits.forEach(([offset, pitchIndex]) => {
            const step = bar + offset;
            if (step < SEQUENCE_LENGTH) byStep.set(step, scalePitches[pitchIndex % scalePitches.length]);
        });
    }

    return Array.from({ length: SEQUENCE_LENGTH }, (_, step) => ({
        active: byStep.has(step),
        pitch: byStep.get(step) || 0,
        scale
    }));
}

function setAiStatus(message, state = '') {
    const status = document.getElementById('ai-status');
    if (!status) return;
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
}

function setAiControlsBusy(isBusy) {
    ['ai-generate-drums', 'ai-generate-bass', 'ai-clear'].forEach(id => {
        const button = document.getElementById(id);
        if (button) button.disabled = isBusy;
    });
}

async function requestServerPattern({ genre, bpm, energy }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
        const response = await fetch('/api/generate-pattern', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ genre, bpm, energy, length: SEQUENCE_LENGTH }),
            signal: controller.signal
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || data?.success !== true || !data.pattern) {
            throw new Error(data?.error || `Pattern service returned ${response.status}`);
        }

        const isValidPattern = SERVER_PATTERN_IDS.every(instrumentId => (
            Array.isArray(data.pattern[instrumentId])
            && data.pattern[instrumentId].length === SEQUENCE_LENGTH
            && data.pattern[instrumentId].every(step => typeof step === 'boolean')
        ));
        if (!isValidPattern) throw new Error('Pattern service returned an invalid sequence');

        return data.pattern;
    } finally {
        clearTimeout(timeoutId);
    }
}

const MAGENTA_CHECKPOINT = 'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/drum_kit_rnn';
const MAGENTA_PITCH_TO_INSTRUMENT = new Map([
    [35, 'kick'], [36, 'kick'],
    [38, 'snare'], [40, 'snare'],
    [39, 'clap'],
    [42, 'hihatClosed'], [44, 'hihatClosed'],
    [46, 'hihatOpened'],
    [41, 'tom'], [43, 'tom'], [45, 'tom'], [47, 'tom'], [48, 'tom'], [50, 'tom'],
    [49, 'crash'], [55, 'crash'], [57, 'crash'], [58, 'crash'],
    [51, 'ride'], [52, 'ride'], [53, 'ride'], [59, 'ride'], [82, 'ride']
]);
const MAGENTA_INSTRUMENT_TO_PITCH = Object.freeze({
    kick: 36,
    snare: 38,
    hihatClosed: 42,
    hihatOpened: 46,
    tom: 45,
    crash: 49,
    ride: 51
});

let drumsRNN = null;
let magentaInitialization = null;
let magentaLibraryLoading = null;

async function loadMagentaLibrary() {
    if (window.mm?.MusicRNN) return window.mm;
    if (magentaLibraryLoading) return magentaLibraryLoading;

    magentaLibraryLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timeoutId = setTimeout(() => {
            script.remove();
            reject(new Error('Magenta.js download timed out'));
        }, 12000);

        script.id = 'magenta-script';
        script.src = 'https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/dist/magentamusic.min.js';
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.addEventListener('load', () => {
            clearTimeout(timeoutId);
            if (window.mm?.MusicRNN) resolve(window.mm);
            else reject(new Error('Magenta.js loaded without MusicRNN'));
        }, { once: true });
        script.addEventListener('error', () => {
            clearTimeout(timeoutId);
            reject(new Error('Magenta.js failed to download'));
        }, { once: true });
        document.head.appendChild(script);
    });

    try {
        return await magentaLibraryLoading;
    } catch (error) {
        magentaLibraryLoading = null;
        document.getElementById('magenta-script')?.remove();
        throw error;
    }
}

async function initializeMagenta() {
    if (drumsRNN) return drumsRNN;
    if (magentaInitialization) return magentaInitialization;

    magentaInitialization = (async () => {
        const magenta = await loadMagentaLibrary();
        const model = new magenta.MusicRNN(MAGENTA_CHECKPOINT);
        try {
            await model.initialize();
            drumsRNN = model;
            console.info('Magenta.js drum model initialized');
            return model;
        } catch (error) {
            try { model.dispose(); } catch (_) {}
            throw error;
        }
    })();

    try {
        return await magentaInitialization;
    } catch (error) {
        drumsRNN = null;
        magentaInitialization = null;
        console.warn('Magenta.js initialization failed:', error);
        throw error;
    }
}

function createMagentaSeed(genre, bpm, energy) {
    const seedPattern = generateRuleBasedPattern(genre, 16, Math.min(0.5, clampEnergy(energy)));
    const notes = [];

    Object.entries(MAGENTA_INSTRUMENT_TO_PITCH).forEach(([instrumentId, pitch]) => {
        seedPattern[instrumentId].forEach((active, step) => {
            if (!active) return;
            notes.push({
                pitch,
                quantizedStartStep: step,
                quantizedEndStep: step + 1,
                isDrum: true
            });
        });
    });

    return {
        notes,
        quantizationInfo: { stepsPerQuarter: 4 },
        totalQuantizedSteps: 16,
        tempos: [{ qpm: bpm }]
    };
}

function convertMagentaToPattern(noteSequence, steps = SEQUENCE_LENGTH) {
    const pattern = createBooleanDrumPattern(steps);

    for (const note of noteSequence?.notes || []) {
        const instrumentId = MAGENTA_PITCH_TO_INSTRUMENT.get(Number(note.pitch));
        const step = Number(note.quantizedStartStep);
        if (!instrumentId || !Number.isInteger(step) || step < 0 || step >= steps) continue;
        pattern[instrumentId][step] = true;
    }

    return pattern;
}

function mergePatterns(basePattern, generatedPattern) {
    const merged = createBooleanDrumPattern(basePattern.kick.length);

    AI_DRUM_IDS.forEach(instrumentId => {
        merged[instrumentId] = merged[instrumentId].map((_, step) => (
            basePattern[instrumentId]?.[step] === true || generatedPattern[instrumentId]?.[step] === true
        ));
    });

    return merged;
}

async function generateMagentaDrums({ genre, bpm, energy, steps = SEQUENCE_LENGTH }) {
    const model = await initializeMagenta();
    const temperature = 0.8 + (clampEnergy(energy) * 0.7);
    const seed = createMagentaSeed(genre, bpm, energy);
    const noteSequence = await model.continueSequence(seed, steps, temperature);
    const magentaPattern = convertMagentaToPattern(noteSequence, steps);
    const generatedHits = Object.values(magentaPattern).reduce(
        (total, track) => total + track.filter(Boolean).length,
        0
    );

    if (generatedHits === 0) throw new Error('Magenta returned an empty sequence');

    // Preserve each genre's core groove while using Magenta for variation.
    const foundation = generateRuleBasedPattern(genre, steps, Math.min(0.3, clampEnergy(energy)));
    return mergePatterns(foundation, magentaPattern);
}

async function generateDrumPatternWithFallback({ genre, bpm, energy }) {
    try {
        return {
            pattern: await requestServerPattern({ genre, bpm, energy }),
            source: 'server'
        };
    } catch (serverError) {
        console.warn('Pattern API unavailable; trying Magenta.js:', serverError);
        setAiStatus('Pattern service unavailable. Trying browser AI…', 'warning');
    }

    try {
        return {
            pattern: await generateMagentaDrums({ genre, bpm, energy }),
            source: 'magenta'
        };
    } catch (magentaError) {
        console.warn('Magenta.js unavailable; using local pattern engine:', magentaError);
        return {
            pattern: generateRuleBasedPattern(genre, SEQUENCE_LENGTH, energy),
            source: 'local'
        };
    }
}

function setupAiControls() {
    const energySlider = document.getElementById('energy-slider');
    const energyDisplay = document.getElementById('energy-display');
    const genreSelect = document.getElementById('genre-select');
    const generateDrumsButton = document.getElementById('ai-generate-drums');
    const generateBassButton = document.getElementById('ai-generate-bass');
    const clearButton = document.getElementById('ai-clear');

    energySlider.addEventListener('input', () => {
        energyDisplay.value = energySlider.value;
        energyDisplay.textContent = energySlider.value;
    });

    generateDrumsButton.addEventListener('click', async () => {
        const genre = genreSelect.value;
        const energy = clampEnergy(energySlider.value);
        setAiControlsBusy(true);
        setAiStatus('Generating a 32-step drum pattern…');

        try {
            const result = await generateDrumPatternWithFallback({ genre, bpm: tempo, energy });
            const hitCount = applyBooleanPattern(result.pattern);
            const sourceLabels = {
                server: 'server generator',
                magenta: 'browser AI',
                local: 'offline generator'
            };
            setAiStatus(`Pattern ready with ${hitCount} hits via ${sourceLabels[result.source]}. Press Play to hear it.`, 'success');
        } catch (error) {
            console.error('Drum generation failed:', error);
            setAiStatus('Could not generate a pattern. Your current sequence was kept.', 'error');
        } finally {
            setAiControlsBusy(false);
        }
    });

    generateBassButton.addEventListener('click', () => {
        const genre = genreSelect.value;
        const energy = clampEnergy(energySlider.value);
        sequences.bass1 = generateBassSequence(genre, energy);
        currentInstrument = 'bass1';
        document.querySelectorAll('.instrument-button').forEach(button => {
            button.classList.toggle('active', button.dataset.instrument === currentInstrument);
        });
        generatePads();
        const hitCount = sequences.bass1.filter(step => step.active).length;
        setAiStatus(`Bass pattern ready with ${hitCount} notes. Press Play to hear it.`, 'success');
    });

    clearButton.addEventListener('click', () => {
        Object.values(sequences).forEach(sequence => {
            sequence.forEach(step => {
                step.active = false;
                step.pitch = 0;
            });
        });
        generatePads();
        setAiStatus('All instrument patterns cleared.');
    });
}

// ============= SAVE / LOAD =============
function savePattern() {
    const data = {
        sequences, tempo, swing,
        volumes: instrumentVolumes,
        muted: mutedInstruments,
        adsr: adsrParams,
        version: 2
    };
    localStorage.setItem('dm99-pattern', JSON.stringify(data));
    showToast('Pattern saved! 💾');
}

function loadPattern() {
    const raw = localStorage.getItem('dm99-pattern');
    if (!raw) { showToast('No saved pattern found'); return; }
    try {
        const data = JSON.parse(raw);
        // Restore sequences
        Object.keys(data.sequences).forEach(id => {
            if (sequences[id]) sequences[id] = data.sequences[id];
        });
        // Restore volumes
        if (data.volumes) Object.keys(data.volumes).forEach(id => {
            if (instrumentVolumes[id] !== undefined) {
                instrumentVolumes[id] = data.volumes[id];
                instrumentGainNodes[id].gain.value = instrumentVolumes[id];
            }
        });
        // Restore tempo/swing
        if (data.tempo) {
            tempo = data.tempo;
            document.getElementById('tempo').value = tempo;
            document.getElementById('bpm-display').textContent = tempo;
        }
        if (data.swing !== undefined) {
            swing = data.swing;
            document.getElementById('swing').value = swing;
            document.getElementById('swing-display').textContent = `${swing}%`;
            swingOffset = swing / 100 * (60 / tempo) / 2;
        }
        // Restore ADSR
        if (data.adsr) Object.keys(data.adsr).forEach(id => {
            if (adsrParams[id]) adsrParams[id] = data.adsr[id];
        });

        generatePads();
        generateInstrumentPanel(); // Refresh mute/solo/volume UI
        showToast('Pattern loaded! 📂');
    } catch(e) {
        showToast('Error loading pattern');
        console.error(e);
    }
}

// ============= TOAST =============
let toastTimeout;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('visible'), 2000);
}

// ============= KEYBOARD SHORTCUTS =============
function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                isPlaying ? stopPlaying() : startPlaying();
                break;
            case 'KeyS':
                if (!e.ctrlKey && !e.metaKey) savePattern();
                break;
            case 'KeyL':
                if (!e.ctrlKey && !e.metaKey) loadPattern();
                break;
            case 'KeyC':
                if (!e.ctrlKey && !e.metaKey) {
                    sequences[currentInstrument].forEach(s => { s.active = false; s.pitch = 0; });
                    generatePads();
                    showToast(`${INSTRUMENT_MAP[currentInstrument].label} cleared`);
                }
                break;
        }
    });
}

// ============= INITIALIZATION =============
async function init() {
    await loadSounds();

    // Hide loading, show app
    const loadingScreen = document.getElementById('loading-screen');
    loadingScreen.classList.add('fade-out');
    setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
    document.getElementById('app').classList.remove('hidden');

    // Generate dynamic UI
    generateInstrumentPanel();
    generatePads();
    generateADSR();
    setupAiControls();

    // Footer year
    document.getElementById('current-year').textContent = new Date().getFullYear();

    // --- Event Listeners ---

    // Master volume
    document.getElementById('master-volume').addEventListener('input', (e) => {
        masterGain.gain.value = parseFloat(e.target.value) * 0.8;
    });

    // Tempo
    document.getElementById('tempo').addEventListener('input', (e) => {
        tempo = parseInt(e.target.value);
        document.getElementById('bpm-display').textContent = tempo;
        swingOffset = swing / 100 * (60 / tempo) / 2;
    });

    // Swing
    document.getElementById('swing').addEventListener('input', (e) => {
        swing = parseInt(e.target.value);
        document.getElementById('swing-display').textContent = `${swing}%`;
        swingOffset = swing / 100 * (60 / tempo) / 2;
    });

    // Filters
    document.getElementById('lowpass-filter').addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        masterLowpass.frequency.value = v;
        document.getElementById('lowpass-display').textContent = v >= 10000 ? `${(v/1000).toFixed(0)}k Hz` : `${v} Hz`;
    });
    document.getElementById('highpass-filter').addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        masterHighpass.frequency.value = v;
        document.getElementById('highpass-display').textContent = `${v} Hz`;
    });

    // EQ sliders (master)
    ['low', 'mid', 'high'].forEach(band => {
        document.getElementById(`eq-${band}`).addEventListener('input', (e) => {
            const g = parseInt(e.target.value);
            eqFilters[band].gain.value = g;
            document.getElementById(`eq-${band}-display`).textContent = `${g} dB`;
        });
    });

    // EQ sliders (bass/synth)
    ['low', 'mid', 'high'].forEach(band => {
        document.getElementById(`bass-eq-${band}`).addEventListener('input', (e) => {
            const g = parseInt(e.target.value);
            bassEqFilters[band].gain.value = g;
            document.getElementById(`bass-eq-${band}-display`).textContent = `${g} dB`;
        });
    });

    // Transport
    document.getElementById('play').addEventListener('click', startPlaying);
    document.getElementById('stop').addEventListener('click', stopPlaying);

    // Random (for current instrument — pitched get melodic, drums get rhythmic)
    document.getElementById('random-pattern').addEventListener('click', () => {
        const inst = INSTRUMENT_MAP[currentInstrument];
        if (inst.pitched) {
            generateRandomSequence(currentInstrument);
        } else {
            // Generate random drum pattern
            const rhythm = RHYTHM_PATTERNS[Math.floor(Math.random() * RHYTHM_PATTERNS.length)];
            const pattern = rhythm.map(h => ({ active: !!h, pitch: 0, scale: 'minor' }));
            sequences[currentInstrument] = [...pattern, ...pattern];
            generatePads();
        }
        showToast(`Random ${inst.label} pattern 🎲`);
    });

    // Clear
    document.getElementById('clear-pattern').addEventListener('click', () => {
        sequences[currentInstrument].forEach(s => { s.active = false; s.pitch = 0; });
        generatePads();
        showToast(`${INSTRUMENT_MAP[currentInstrument].label} cleared 🗑️`);
    });

    // Save / Load
    document.getElementById('save-pattern').addEventListener('click', savePattern);
    document.getElementById('load-pattern').addEventListener('click', loadPattern);

    // ADSR toggle
    const adsrContent = document.getElementById('adsr-content');
    document.getElementById('adsr-toggle').addEventListener('click', () => {
        const open = adsrContent.style.display === 'block';
        adsrContent.style.display = open ? 'none' : 'block';
        document.getElementById('adsr-toggle').textContent = open ? 'ADSR Controls ▼' : 'ADSR Controls ▲';
    });

    // Modal
    const modal = document.getElementById('modal');
    document.getElementById('show-instructions').addEventListener('click', () => { modal.style.display = 'flex'; });
    document.getElementById('close-modal').addEventListener('click', () => { modal.style.display = 'none'; });
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Keyboard shortcuts
    setupKeyboard();

}

document.addEventListener('DOMContentLoaded', init);

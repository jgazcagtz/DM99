// ═══════════════════════════════════════════════════════════════════
//  DM99 v2.0 — Config-Driven Drum Machine & Step Sequencer
// ═══════════════════════════════════════════════════════════════════

// ============= INSTRUMENT CONFIGURATION =============
const INSTRUMENTS = [
    // --- Drums ---
    { id: 'kick', label: 'Kick', group: 'Drums', volume: 0.8, mono: true,
      url: 'https://cdn.freesound.org/previews/348/348054_6244580-lq.mp3',
      adsr: { attack: 0.01, decay: 0.3, sustain: 0.0, release: 0.2 } },
    { id: 'snare', label: 'Snare', group: 'Drums', volume: 0.7,
      url: 'https://cdn.freesound.org/previews/25/25666_48671-lq.mp3' },
    { id: 'clap', label: 'Clap', group: 'Drums', volume: 0.7,
      url: 'https://cdn.freesound.org/previews/244/244568_165785-lq.mp3' },
    { id: 'tom', label: 'Tom', group: 'Drums', volume: 0.7,
      url: 'https://cdn.freesound.org/previews/443/443181_6979693-lq.mp3' },
    { id: 'rimshot', label: 'Rim', group: 'Drums', volume: 0.65,
      url: 'https://cdn.freesound.org/previews/250/250552_4486188-lq.mp3' },
    { id: 'cowbell', label: 'Cow', group: 'Drums', volume: 0.55,
      url: 'https://cdn.freesound.org/previews/351/351649_6295857-lq.mp3' },
    // --- Cymbals ---
    { id: 'hihatClosed', label: 'HHC', group: 'Cymbals', volume: 0.6,
      url: 'https://cdn.freesound.org/previews/638/638654_433684-lq.mp3',
      adsr: { attack: 0.005, decay: 0.15, sustain: 0.0, release: 0.1 } },
    { id: 'hihatOpened', label: 'HHO', group: 'Cymbals', volume: 0.6,
      url: 'https://cdn.freesound.org/previews/627/627344_13191763-lq.mp3' },
    { id: 'crash', label: 'Crash', group: 'Cymbals', volume: 0.45,
      url: 'https://cdn.freesound.org/previews/387/387186_7255534-lq.mp3' },
    { id: 'ride', label: 'Ride', group: 'Cymbals', volume: 0.45,
      url: 'https://cdn.freesound.org/previews/398/398228_2613581-lq.mp3' },
    // --- Percussion ---
    { id: 'perc1', label: 'Perc1', group: 'Perc', volume: 0.6,
      url: 'https://cdn.freesound.org/previews/724/724509_11990934-lq.mp3' },
    { id: 'perc2', label: 'Perc2', group: 'Perc', volume: 0.6,
      url: 'https://cdn.freesound.org/previews/503/503788_9637845-lq.mp3' },
    { id: 'perc3', label: 'Perc3', group: 'Perc', volume: 0.6,
      url: 'https://cdn.freesound.org/previews/503/503779_9637845-lq.mp3' },
    { id: 'perc4', label: 'Perc4', group: 'Perc', volume: 0.6,
      url: 'https://cdn.freesound.org/previews/352/352280_1866366-lq.mp3' },
    { id: 'perc5', label: 'Perc5', group: 'Perc', volume: 0.6,
      url: 'https://cdn.freesound.org/previews/638/638557_12672694-lq.mp3' },
    { id: 'perc6', label: 'Perc6', group: 'Perc', volume: 0.6,
      url: 'https://cdn.freesound.org/previews/707/707194_6295857-lq.mp3' },
    { id: 'shaker', label: 'Shak', group: 'Perc', volume: 0.5,
      url: 'https://cdn.freesound.org/previews/446/446461_7037_lq.mp3' },
    { id: 'tamb', label: 'Tamb', group: 'Perc', volume: 0.5,
      url: 'https://cdn.freesound.org/previews/207/207920_19852-lq.mp3' },
    // --- Tonal (sample-based, pitched) ---
    { id: 'bass1', label: 'Bass', group: 'Tonal', volume: 0.5, mono: true, pitched: true,
      url: 'https://cdn.freesound.org/previews/711/711469_15225418-lq.mp3',
      adsr: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 } },
    { id: 'acid', label: 'Acid', group: 'Tonal', volume: 0.6, pitched: true,
      url: 'https://cdn.freesound.org/previews/21/21998_45941-lq.mp3',
      adsr: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2 } },
    { id: 'synth', label: 'Synth', group: 'Tonal', volume: 0.6, pitched: true,
      url: 'https://cdn.freesound.org/previews/315/315610_2050105-lq.mp3',
      adsr: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.5 } },
    // --- Synth (oscillator-based, pitched) ---
    { id: 'sub', label: 'Sub', group: 'Synth', volume: 0.6, pitched: true,
      synth: { waveform: 'sine', baseFreq: 41.2 },
      adsr: { attack: 0.01, decay: 0.5, sustain: 0.8, release: 0.3 } },
    { id: 'tr808', label: '808', group: 'Synth', volume: 0.6, pitched: true,
      synth: { waveform: 'triangle', baseFreq: 55, pitchDecay: true },
      adsr: { attack: 0.001, decay: 0.8, sustain: 0.0, release: 0.1 } },
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
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

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
    // Route pitched/synth instruments through bass EQ, others direct to master
    gn.connect((inst.pitched || inst.synth) ? bassEqFilters.low : masterGain);
    instrumentGainNodes[inst.id] = gn;
});

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
    sequences[inst.id] = Array.from({ length: 32 }, () => ({ active: false, pitch: 0, scale: 'minor' }));
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

// ============= SOUND LOADING =============
async function loadSounds() {
    const sampleInstruments = INSTRUMENTS.filter(i => i.url);
    let loaded = 0;
    const total = sampleInstruments.length;
    const progressEl = document.getElementById('loader-progress');
    const textEl = document.getElementById('loader-text');

    for (const inst of sampleInstruments) {
        try {
            textEl.textContent = `Loading ${inst.label}...`;
            const response = await fetch(inst.url);
            const arrayBuffer = await response.arrayBuffer();
            let audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            // Convert to mono if needed
            if (inst.mono && audioBuffer.numberOfChannels > 1) {
                const len = audioBuffer.length;
                const sr = audioBuffer.sampleRate;
                const nc = audioBuffer.numberOfChannels;
                const monoBuffer = audioCtx.createBuffer(1, len, sr);
                const monoData = monoBuffer.getChannelData(0);
                for (let s = 0; s < len; s++) {
                    let sum = 0;
                    for (let c = 0; c < nc; c++) sum += audioBuffer.getChannelData(c)[s];
                    monoData[s] = sum / nc;
                }
                audioBuffer = monoBuffer;
            }
            buffers[inst.id] = audioBuffer;
        } catch (err) {
            console.warn(`Failed to load ${inst.label}: ${err.message}`);
        }
        loaded++;
        if (progressEl) progressEl.style.width = `${(loaded / total) * 100}%`;
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

// ============= PLAY SYNTH NOTE (oscillator-based) =============
function playSynthNote(instConfig, time, pitch) {
    const sd = instConfig.synth;
    const adsr = adsrParams[instConfig.id] || { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.2 };
    const freq = Math.max(20, sd.baseFreq * Math.pow(2, (pitch - 12) / 12));

    const osc = audioCtx.createOscillator();
    const envGain = audioCtx.createGain();

    osc.type = sd.waveform;
    osc.frequency.setValueAtTime(freq, time);
    if (sd.pitchDecay) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(freq * 0.2, 20), time + 0.4);
    }

    const a = adsr.attack, d = adsr.decay, s = adsr.sustain, r = adsr.release;
    envGain.gain.setValueAtTime(0, time);
    envGain.gain.linearRampToValueAtTime(1, time + a);
    envGain.gain.linearRampToValueAtTime(Math.max(s, 0.001), time + a + d);
    const holdEnd = time + a + d + 0.05;
    envGain.gain.setValueAtTime(Math.max(s, 0.001), holdEnd);
    envGain.gain.linearRampToValueAtTime(0.001, holdEnd + r);

    osc.connect(envGain);
    envGain.connect(instrumentGainNodes[instConfig.id]);

    const stopTime = holdEnd + r + 0.05;
    osc.start(time);
    osc.stop(stopTime);
    osc.onended = () => { osc.disconnect(); envGain.disconnect(); };
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
    currentStep = (currentStep + 1) % 32;
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

        if (inst.synth) {
            playSynthNote(inst, adjustedTime, s.pitch);
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

    for (let i = 0; i < 32; i++) {
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

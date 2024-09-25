// AudioContext Setup
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// Define which instruments should be mono
const monoInstruments = [
    'kick', 'bass1',
];

// Sound URLs
const sounds = {
    kick: 'https://cdn.freesound.org/previews/348/348054_6244580-lq.mp3',
    snare: 'https://cdn.freesound.org/previews/25/25666_48671-lq.mp3',
    hihatClosed: 'https://cdn.freesound.org/previews/638/638654_433684-lq.mp3',
    hihatOpened: 'https://cdn.freesound.org/previews/627/627344_13191763-lq.mp3',
    clap: 'https://cdn.freesound.org/previews/244/244568_165785-lq.mp3',
    bass1: 'https://cdn.freesound.org/previews/711/711469_15225418-lq.mp3',
    tom: 'https://cdn.freesound.org/previews/443/443181_6979693-lq.mp3',
    perc1: 'https://cdn.freesound.org/previews/724/724509_11990934-lq.mp3',
    perc2: 'https://cdn.freesound.org/previews/503/503788_9637845-lq.mp3',
    perc3: 'https://cdn.freesound.org/previews/503/503779_9637845-lq.mp3',
    perc4: 'https://cdn.freesound.org/previews/352/352280_1866366-lq.mp3',
    perc5: 'https://cdn.freesound.org/previews/638/638557_12672694-lq.mp3',
    perc6: 'https://cdn.freesound.org/previews/707/707194_6295857-lq.mp3',
    acid: 'https://cdn.freesound.org/previews/21/21998_45941-lq.mp3',
    synth: 'https://cdn.freesound.org/previews/315/315610_2050105-lq.mp3', // New Synth Sample
};
const buffers = {};

// Preload Audio Buffers and Convert to Mono if needed
async function loadSounds() {
    const keys = Object.keys(sounds);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const url = sounds[key];
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            let audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            // Convert to mono if necessary
            if (monoInstruments.includes(key)) {
                const numChannels = audioBuffer.numberOfChannels;
                const length = audioBuffer.length;
                const sampleRate = audioBuffer.sampleRate;
                const monoBuffer = audioCtx.createBuffer(1, length, sampleRate);
                const monoData = monoBuffer.getChannelData(0);
                // Average all channels
                for (let sample = 0; sample < length; sample++) {
                    let sum = 0;
                    for (let channel = 0; channel < numChannels; channel++) {
                        sum += audioBuffer.getChannelData(channel)[sample];
                    }
                    monoData[sample] = sum / numChannels;
                }
                buffers[key] = monoBuffer;
            } else {
                buffers[key] = audioBuffer;
            }
        } catch (error) {
            console.error(`Error loading sound for ${key}:`, error);
        }
    }
}

// Variables
let currentInstrument = 'kick';
let isPlaying = false;
let currentNote = 0;
let tempo = 120;
let swing = 0; // Swing percentage (0-100)
let timerID;
let swingOffset = 0;

// Sequences
const sequences = {
    kick: new Array(32).fill(false),
    snare: new Array(32).fill(false),
    hihatClosed: new Array(32).fill(false),
    hihatOpened: new Array(32).fill(false),
    clap: new Array(32).fill(false),
    bass1: new Array(32).fill(false).map(() => ({ active: false, pitch: 0 })),
    tom: new Array(32).fill(false),
    perc1: new Array(32).fill(false),
    perc2: new Array(32).fill(false),
    perc3: new Array(32).fill(false),
    perc4: new Array(32).fill(false),
    perc5: new Array(32).fill(false),
    perc6: new Array(32).fill(false),
    acid: new Array(32).fill(false),
    synth: new Array(32).fill(false).map(() => ({ active: false, pitch: 0 })), // New Synth Sequence
};

// Mute and Solo States
const mutedInstruments = {};
const soloedInstruments = {};
Object.keys(sequences).forEach(inst => {
    mutedInstruments[inst] = false;
    soloedInstruments[inst] = false;
});

// Instrument Volumes
const instrumentVolumes = {
    kick: 0.8,
    snare: 0.7,
    hihatClosed: 0.6,
    hihatOpened: 0.6,
    clap: 0.7,
    bass1: 0.5,
    tom: 0.7,
    perc1: 0.6,
    perc2: 0.6,
    perc3: 0.6,
    perc4: 0.6,
    perc5: 0.6,
    perc6: 0.6,
    acid: 0.6,
    synth: 0.6, // New Synth Volume
};

// ADSR Parameters
const adsrParameters = {
    kick: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 },
    hihatClosed: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.3 },
    hihatOpened: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.3 },
    bass1: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 }, // New ADSR for Bass
    synth: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 }, // New ADSR for Synth
};

// Master Volume Setup
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.8; // Reduced to prevent clipping

// Add a compressor to prevent clipping
const masterCompressor = audioCtx.createDynamicsCompressor();
masterCompressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
masterCompressor.knee.setValueAtTime(30, audioCtx.currentTime);
masterCompressor.ratio.setValueAtTime(12, audioCtx.currentTime);
masterCompressor.attack.setValueAtTime(0, audioCtx.currentTime);
masterCompressor.release.setValueAtTime(0.25, audioCtx.currentTime);

// Master Low-Pass Filter
const masterLowpass = audioCtx.createBiquadFilter();
masterLowpass.type = 'lowpass';
masterLowpass.frequency.value = 20000; // Set initial frequency

// Master High-Pass Filter
const masterHighpass = audioCtx.createBiquadFilter();
masterHighpass.type = 'highpass';
masterHighpass.frequency.value = 20; // Set initial frequency

// Equalizer Filters
const eqFilters = {
    low: audioCtx.createBiquadFilter(),
    mid: audioCtx.createBiquadFilter(),
    high: audioCtx.createBiquadFilter()
};

// Configure EQ Filters
eqFilters.low.type = 'lowshelf';
eqFilters.low.frequency.value = 320;

eqFilters.mid.type = 'peaking';
eqFilters.mid.frequency.value = 1000;
eqFilters.mid.Q.value = 1;

eqFilters.high.type = 'highshelf';
eqFilters.high.frequency.value = 3200;

// Bass EQ Filters
const bassEqFilters = {
    low: audioCtx.createBiquadFilter(),
    mid: audioCtx.createBiquadFilter(),
    high: audioCtx.createBiquadFilter()
};

// Configure Bass EQ Filters
bassEqFilters.low.type = 'lowshelf';
bassEqFilters.low.frequency.value = 80;

bassEqFilters.mid.type = 'peaking';
bassEqFilters.mid.frequency.value = 500;
bassEqFilters.mid.Q.value = 1;

bassEqFilters.high.type = 'highshelf';
bassEqFilters.high.frequency.value = 2000;

// Connect the audio nodes: Master Gain -> EQ Filters -> High-Pass Filter -> Low-Pass Filter -> Compressor -> Destination
masterGain.connect(eqFilters.low);
eqFilters.low.connect(eqFilters.mid);
eqFilters.mid.connect(eqFilters.high);
eqFilters.high.connect(masterHighpass);
masterHighpass.connect(masterLowpass);
masterLowpass.connect(masterCompressor);
masterCompressor.connect(audioCtx.destination);

// Create per-instrument gain nodes
const instrumentGainNodes = {};
Object.keys(instrumentVolumes).forEach(instrument => {
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = instrumentVolumes[instrument];
    if (instrument === 'bass1' || instrument === 'synth') {
        // Connect Bass EQ Filters
        gainNode.connect(bassEqFilters.low);
        bassEqFilters.low.connect(bassEqFilters.mid);
        bassEqFilters.mid.connect(bassEqFilters.high);
        bassEqFilters.high.connect(masterGain);
    } else {
        gainNode.connect(masterGain);
    }
    instrumentGainNodes[instrument] = gainNode;
});

// Define scale pitches based on E0 sample to reach desired notes
const minorScalePitches = [0, 2, 3, 5, 7, 8, 10]; // E natural minor: E, F#, G, A, B, C, D
const phrygianScalePitches = [0, 1, 3, 5, 7, 8, 10]; // E Phrygian: E, F, G, A, B, C, D

// Function to get scale pitches based on selected scale
function getScalePitches(scale) {
    if (scale === 'minor') {
        return minorScalePitches;
    } else if (scale === 'phrygian') {
        return phrygianScalePitches;
    } else {
        return minorScalePitches; // Default to minor
    }
}

// Initialize the application
async function init() {
    // Wait for DOM to be fully loaded
    await loadSounds();

    // DOM Elements
    const instrumentButtons = document.querySelectorAll('.instrument-button');
    const muteButtons = document.querySelectorAll('.mute-button');
    const soloButtons = document.querySelectorAll('.solo-button');
    const volumeSliders = document.querySelectorAll('.volume-slider');
    const drumMachine = document.getElementById('drum-machine');
    const playButton = document.getElementById('play');
    const stopButton = document.getElementById('stop');
    const randomBassButton = document.getElementById('random-bass');
    const randomSynthButton = document.getElementById('random-synth');
    const tempoSlider = document.getElementById('tempo');
    const bpmDisplay = document.getElementById('bpm-display');
    const swingSlider = document.getElementById('swing');
    const swingDisplay = document.getElementById('swing-display');
    const lowpassSlider = document.getElementById('lowpass-filter');
    const lowpassDisplay = document.getElementById('lowpass-display');
    const highpassSlider = document.getElementById('highpass-filter');
    const highpassDisplay = document.getElementById('highpass-display');
    const eqLowSlider = document.getElementById('eq-low');
    const eqMidSlider = document.getElementById('eq-mid');
    const eqHighSlider = document.getElementById('eq-high');
    const eqLowDisplay = document.getElementById('eq-low-display');
    const eqMidDisplay = document.getElementById('eq-mid-display');
    const eqHighDisplay = document.getElementById('eq-high-display');
    const bassEqLowSlider = document.getElementById('bass-eq-low');
    const bassEqMidSlider = document.getElementById('bass-eq-mid');
    const bassEqHighSlider = document.getElementById('bass-eq-high');
    const bassEqLowDisplay = document.getElementById('bass-eq-low-display');
    const bassEqMidDisplay = document.getElementById('bass-eq-mid-display');
    const bassEqHighDisplay = document.getElementById('bass-eq-high-display');
    const showInstructionsButton = document.getElementById('show-instructions');
    const modal = document.getElementById('modal');
    const closeModalButton = document.getElementById('close-modal');
    const adsrToggle = document.getElementById('adsr-toggle');
    const adsrContent = document.getElementById('adsr-content');
    const masterVolumeSlider = document.getElementById('master-volume');

    // Initialize swing and filter displays
    swingDisplay.textContent = `${swing}%`;
    lowpassDisplay.textContent = `${lowpassSlider.value} Hz`;
    highpassDisplay.textContent = `${highpassSlider.value} Hz`;
    eqLowDisplay.textContent = `${eqLowSlider.value} dB`;
    eqMidDisplay.textContent = `${eqMidSlider.value} dB`;
    eqHighDisplay.textContent = `${eqHighSlider.value} dB`;
    bassEqLowDisplay.textContent = `${bassEqLowSlider.value} dB`;
    bassEqMidDisplay.textContent = `${bassEqMidSlider.value} dB`;
    bassEqHighDisplay.textContent = `${bassEqHighSlider.value} dB`;

    generatePads();
    instrumentButtons[0].classList.add('active');
    updatePads();

    bpmDisplay.textContent = tempo;
    swingDisplay.textContent = `${swing}%`;
    swingOffset = swing / 100 * (60 / tempo) / 2;
    lowpassDisplay.textContent = `${lowpassSlider.value} Hz`;
    highpassDisplay.textContent = `${highpassSlider.value} Hz`;
    eqLowDisplay.textContent = `${eqLowSlider.value} dB`;
    eqMidDisplay.textContent = `${eqMidSlider.value} dB`;
    eqHighDisplay.textContent = `${eqHighSlider.value} dB`;
    bassEqLowDisplay.textContent = `${bassEqLowSlider.value} dB`;
    bassEqMidDisplay.textContent = `${bassEqMidSlider.value} dB`;
    bassEqHighDisplay.textContent = `${bassEqHighSlider.value} dB`;
    document.getElementById('current-year').textContent = new Date().getFullYear();

    // Set initial filter frequencies based on slider values
    masterLowpass.frequency.value = parseInt(lowpassSlider.value);
    masterHighpass.frequency.value = parseInt(highpassSlider.value);

    // Now, move all event listeners and functions that use DOM elements inside init()

    // Instrument Button Events
    instrumentButtons.forEach(button => {
        button.addEventListener('click', () => {
            instrumentButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentInstrument = button.dataset.instrument;
            generatePads();
        });
    });

    // Mute Button Events
    muteButtons.forEach(button => {
        button.addEventListener('click', () => {
            const instrument = button.dataset.instrument;
            mutedInstruments[instrument] = !mutedInstruments[instrument];
            button.classList.toggle('muted', mutedInstruments[instrument]);
            updateGainNodes();
        });
    });

    // Solo Button Events
    soloButtons.forEach(button => {
        button.addEventListener('click', () => {
            const instrument = button.dataset.instrument;
            soloedInstruments[instrument] = !soloedInstruments[instrument];
            button.classList.toggle('active', soloedInstruments[instrument]);
            updateGainNodes();
        });
    });

    // Volume Slider Events
    volumeSliders.forEach(slider => {
        slider.addEventListener('input', () => {
            const instrument = slider.dataset.instrument;
            instrumentVolumes[instrument] = parseFloat(slider.value);
            instrumentGainNodes[instrument].gain.value = instrumentVolumes[instrument];
            updateGainNodes();
        });
    });

    // Master Volume Control
    masterVolumeSlider.addEventListener('input', () => {
        masterGain.gain.value = parseFloat(masterVolumeSlider.value) * 0.8; // Adjust for initial 0.8
    });

    // ADSR Slider Events
    const adsrSliders = document.querySelectorAll('.adsr-slider');
    adsrSliders.forEach(slider => {
        slider.addEventListener('input', () => {
            const instrument = slider.dataset.instrument;
            const param = slider.dataset.param;
            if (adsrParameters[instrument]) {
                adsrParameters[instrument][param] = parseFloat(slider.value);
            }
        });
    });

    // Low-Pass Filter Slider Event
    lowpassSlider.addEventListener('input', () => {
        const freq = parseInt(lowpassSlider.value);
        masterLowpass.frequency.value = freq;
        lowpassDisplay.textContent = `${freq} Hz`;
    });

    // High-Pass Filter Slider Event
    highpassSlider.addEventListener('input', () => {
        const freq = parseInt(highpassSlider.value);
        masterHighpass.frequency.value = freq;
        highpassDisplay.textContent = `${freq} Hz`;
    });

    // Equalizer Slider Events
    eqLowSlider.addEventListener('input', () => {
        const gain = parseInt(eqLowSlider.value);
        eqFilters.low.gain.value = gain;
        eqLowDisplay.textContent = `${gain} dB`;
    });

    eqMidSlider.addEventListener('input', () => {
        const gain = parseInt(eqMidSlider.value);
        eqFilters.mid.gain.value = gain;
        eqMidDisplay.textContent = `${gain} dB`;
    });

    eqHighSlider.addEventListener('input', () => {
        const gain = parseInt(eqHighSlider.value);
        eqFilters.high.gain.value = gain;
        eqHighDisplay.textContent = `${gain} dB`;
    });

    // Bass EQ Slider Events
    bassEqLowSlider.addEventListener('input', () => {
        const gain = parseInt(bassEqLowSlider.value);
        bassEqFilters.low.gain.value = gain;
        bassEqLowDisplay.textContent = `${gain} dB`;
    });

    bassEqMidSlider.addEventListener('input', () => {
        const gain = parseInt(bassEqMidSlider.value);
        bassEqFilters.mid.gain.value = gain;
        bassEqMidDisplay.textContent = `${gain} dB`;
    });

    bassEqHighSlider.addEventListener('input', () => {
        const gain = parseInt(bassEqHighSlider.value);
        bassEqFilters.high.gain.value = gain;
        bassEqHighDisplay.textContent = `${gain} dB`;
    });

    // Swing Slider Event
    swingSlider.addEventListener('input', () => {
        swing = parseInt(swingSlider.value);
        swingDisplay.textContent = `${swing}%`;
        swingOffset = swing / 100 * (60 / tempo) / 2; // Calculate swing offset based on tempo
    });

    // Adjust Tempo
    tempoSlider.addEventListener('input', () => {
        tempo = parseInt(tempoSlider.value);
        bpmDisplay.textContent = tempo;
        // Recalculate swing offset based on new tempo
        swingOffset = swing / 100 * (60 / tempo) / 2;
    });

    // Play/Stop Button Events
    playButton.addEventListener('click', async () => {
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        startPlaying();
    });

    stopButton.addEventListener('click', () => {
        stopPlaying();
    });

    // Random Bass Line Generator
    randomBassButton.addEventListener('click', () => {
        generateRandomSequence('bass1');
    });

    // Random Synth Line Generator
    randomSynthButton.addEventListener('click', () => {
        generateRandomSequence('synth');
    });

    // ADSR Controls Toggle
    adsrToggle.addEventListener('click', () => {
        adsrContent.style.display = adsrContent.style.display === 'block' ? 'none' : 'block';
        adsrToggle.textContent = adsrContent.style.display === 'block' ? 'ADSR Controls ▲' : 'ADSR Controls ▼';
    });

    // Instructions Modal Events
    showInstructionsButton.addEventListener('click', () => {
        modal.style.display = 'flex';
    });

    closeModalButton.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target == modal) {
            modal.style.display = 'none';
        }
    });
}

// Call init() after the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    init();
});

// Generate Pads
function generatePads() {
    const drumMachine = document.getElementById('drum-machine');
    drumMachine.innerHTML = '';
    for (let i = 0; i < 32; i++) { // 32 pads
        const pad = document.createElement('div');
        pad.classList.add('pad');
        pad.dataset.step = i + 1;
        pad.dataset.index = i;

        drumMachine.appendChild(pad);

        if (currentInstrument === 'bass1' || currentInstrument === 'synth') {
            // Create pitch knob
            const knobContainer = document.createElement('div');
            knobContainer.classList.add('pitch-knob');
            pad.appendChild(knobContainer);

            const step = sequences[currentInstrument][i];
            const scalePitches = getScalePitches(step.scale || 'minor'); // Use the step's scale or default to 'minor'
            const pitchIndex = scalePitches.indexOf(step.pitch);
            const knob = new Nexus.Dial(knobContainer, {
                size: [40, 40],
                min: 0,
                max: scalePitches.length - 1,
                step: 1,
                value: pitchIndex >= 0 ? pitchIndex : 0
            });

            knob.on('change', (v) => {
                const index = Math.round(v);
                sequences[currentInstrument][i].pitch = scalePitches[index];
            });

            knob.colorize("fill", "#00e676");
            knob.colorize("accent", "#00e676");

            knobContainer.style.display = step.active ? 'block' : 'none';

            pad.addEventListener('click', () => {
                const step = sequences[currentInstrument][i];
                step.active = !step.active;
                pad.classList.toggle('active', step.active);
                knobContainer.style.display = step.active ? 'block' : 'none';
            });
        } else {
            pad.addEventListener('click', () => {
                sequences[currentInstrument][i] = !sequences[currentInstrument][i];
                pad.classList.toggle('active', sequences[currentInstrument][i]);
            });
        }
    }
    updatePads();
}

// Update Pads
function updatePads() {
    const pads = document.querySelectorAll('.pad');
    pads.forEach((pad, index) => {
        if (currentInstrument === 'bass1' || currentInstrument === 'synth') {
            pad.classList.toggle('active', sequences[currentInstrument][index].active);
        } else {
            pad.classList.toggle('active', sequences[currentInstrument][index]);
        }
    });
}

// Update Gain Nodes based on Mute and Solo States
function updateGainNodes() {
    const isAnySoloed = isAnySoloedFunction();
    Object.keys(instrumentGainNodes).forEach(instrument => {
        if (isAnySoloed) {
            // If the instrument is soloed, set volume to its slider value
            if (soloedInstruments[instrument]) {
                instrumentGainNodes[instrument].gain.value = instrumentVolumes[instrument];
            } else {
                // Otherwise, set volume to 0
                instrumentGainNodes[instrument].gain.value = 0;
            }
        } else {
            // If no solos, set volume based on mute and slider
            if (mutedInstruments[instrument]) {
                instrumentGainNodes[instrument].gain.value = 0;
            } else {
                instrumentGainNodes[instrument].gain.value = instrumentVolumes[instrument];
            }
        }
    });
}

// Play Sound with ADSR Envelope
function playSound(buffer, time, playbackRate = 1, duration = null, instrument = null, adsr = null) {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gainNode = audioCtx.createGain();

    if (adsr) {
        const now = time;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(1, now + adsr.attack);
        gainNode.gain.linearRampToValueAtTime(adsr.sustain, now + adsr.attack + adsr.decay);
        gainNode.gain.setValueAtTime(adsr.sustain, now + adsr.attack + adsr.decay);
        if (duration) {
            gainNode.gain.setValueAtTime(adsr.sustain, now + duration);
            gainNode.gain.linearRampToValueAtTime(0, now + duration + adsr.release);
        } else {
            gainNode.gain.linearRampToValueAtTime(0, now + adsr.release);
        }
    }

    source.connect(gainNode);
    gainNode.connect(instrumentGainNodes[instrument]);
    source.start(time);
    if (duration) {
        source.stop(time + duration + (adsr ? adsr.release : 0));
    }
    return source;
}

// Scheduler
function scheduler() {
    while (nextNoteTime < audioCtx.currentTime + 0.1) {
        scheduleNote(currentNote, nextNoteTime);
        nextNote();
    }
    timerID = setTimeout(scheduler, 25);
}

let nextNoteTime = 0.0;

function nextNote() {
    const secondsPerBeat = 60.0 / tempo;
    nextNoteTime += 0.25 * secondsPerBeat;
    currentNote = (currentNote + 1) % 32; // 32 steps
}

// Schedule Note with Swing
function scheduleNote(beatNumber, time) {
    // Highlight the pads
    const pads = document.querySelectorAll('.pad');
    pads.forEach((pad, index) => {
        pad.classList.toggle('playing', index === beatNumber);
    });

    // Calculate swing offset for even beats
    let adjustedTime = time;
    if ((beatNumber % 2) === 1) { // Even step in 0-based index
        adjustedTime += swingOffset;
    }

    // Play sounds
    Object.keys(sequences).forEach(instrument => {
        if (mutedInstruments[instrument] || (isAnySoloedFunction() && !soloedInstruments[instrument])) return;

        if (instrument === 'bass1' || instrument === 'synth') {
            const step = sequences[instrument][beatNumber];
            if (step.active) {
                const scalePitches = getScalePitches(step.scale || 'minor');
                const pitch = Math.pow(2, (step.pitch - 12) / 12); // Adjusted to center around E0
                let adsr = null;
                if (adsrParameters[instrument]) {
                    adsr = adsrParameters[instrument];
                }
                playSound(buffers[instrument], adjustedTime, pitch, null, instrument, adsr);
            }
        } else {
            if (sequences[instrument][beatNumber]) {
                let adsr = null;
                if (adsrParameters[instrument]) {
                    adsr = adsrParameters[instrument];
                }
                playSound(buffers[instrument], adjustedTime, 1, null, instrument, adsr);
            }
        }
    });
}

// Check if any instrument is soloed
function isAnySoloedFunction() {
    return Object.values(soloedInstruments).some(val => val);
}

// Start Playing
function startPlaying() {
    if (!isPlaying) {
        isPlaying = true;
        currentNote = 0;
        nextNoteTime = audioCtx.currentTime + 0.05;
        scheduler();
    }
}

// Stop Playing
function stopPlaying() {
    if (isPlaying) {
        isPlaying = false;
        clearTimeout(timerID);
        const pads = document.querySelectorAll('.pad');
        pads.forEach(pad => pad.classList.remove('playing'));
    }
}

// Function to generate random sequence
function generateRandomSequence(instrument) {
    const rhythmicPatterns = [
        // Pattern 1: Common 4-on-the-floor
        [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        // Pattern 2: Breakbeat style
        [true, false, true, false, false, true, false, false, true, false, true, false, false, true, false, false],
        // Pattern 3: Syncopated
        [false, true, false, true, false, false, true, false, true, false, false, true, false, true, false, false],
        // Pattern 4: Sparse
        [true, false, false, true, false, false, false, true, false, false, true, false, false, false, true, false],
        // Pattern 5: Dense
        [true, true, false, true, true, false, true, true, false, true, true, false, true, true, false, true],
        // Pattern 6: Off-beat
        [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true],
        // Pattern 7: Triplet feel
        [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, true],
        // Pattern 8: Funky
        [true, false, true, false, true, false, false, true, false, true, false, true, false, true, false, false],
        // Pattern 9: Swing
        [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, true],
        // Pattern 10: Random hits
        [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
    ];

    // Randomly select a rhythmic pattern
    const rhythm = rhythmicPatterns[Math.floor(Math.random() * rhythmicPatterns.length)];

    // Randomly select a scale: 'minor' or 'phrygian'
    const scales = ['minor', 'phrygian'];
    const selectedScale = scales[Math.floor(Math.random() * scales.length)];
    const scalePitches = getScalePitches(selectedScale);

    const pattern = [];
    for (let i = 0; i < rhythm.length; i++) {
        if (rhythm[i]) {
            let pitch;
            if (i === 0 || i === rhythm.length - 1) {
                // Start and end with root note (0)
                pitch = 0;
            } else {
                pitch = scalePitches[Math.floor(Math.random() * scalePitches.length)];
            }
            pattern.push({
                active: true,
                pitch: pitch,
                scale: selectedScale
            });
        } else {
            // Rest
            pattern.push({
                active: false,
                pitch: 0,
                scale: selectedScale
            });
        }
    }

    // Repeat the pattern to fill 32 steps
    sequences[instrument] = [];
    for (let i = 0; i < 2; i++) {
        sequences[instrument] = sequences[instrument].concat(pattern);
    }

    if (currentInstrument === instrument) {
        generatePads();
    }
}

// AudioContext Setup
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// Define which instruments should be mono
const monoInstruments = [
    'kick', 'snare', 'hihatClosed', 'hihatOpened', 'clap', 'tom',
    'perc1', 'perc2', 'perc3', 'perc4', 'perc5', 'perc6','acid'
];

// Sound URLs
const sounds = {
    kick: 'https://cdn.freesound.org/previews/348/348054_6244580-lq.mp3',
    snare: 'https://cdn.freesound.org/previews/25/25666_48671-lq.mp3',
    hihatClosed: 'https://cdn.freesound.org/previews/638/638654_433684-lq.mp3',
    hihatOpened: 'https://cdn.freesound.org/previews/627/627344_13191763-lq.mp3',
    clap: 'https://cdn.freesound.org/previews/244/244568_165785-lq.mp3',
    bass1: 'https://cdn.freesound.org/previews/711/711461_15225418-lq.mp3',  
    tom: 'https://cdn.freesound.org/previews/443/443181_6979693-lq.mp3',
    perc1: 'https://cdn.freesound.org/previews/724/724509_11990934-lq.mp3',
    perc2: 'https://cdn.freesound.org/previews/503/503788_9637845-lq.mp3',
    perc3: 'https://cdn.freesound.org/previews/503/503779_9637845-lq.mp3',
    perc4: 'https://cdn.freesound.org/previews/352/352280_1866366-lq.mp3',
    perc5: 'https://cdn.freesound.org/previews/638/638557_12672694-lq.mp3',
    perc6: 'https://cdn.freesound.org/previews/707/707194_6295857-lq.mp3',
  acid: 'https://cdn.freesound.org/previews/21/21998_45941-lq.mp3'
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
const instrumentButtons = document.querySelectorAll('.instrument-button');
const muteButtons = document.querySelectorAll('.mute-button');
const soloButtons = document.querySelectorAll('.solo-button');
const volumeSliders = document.querySelectorAll('.volume-slider');
const drumMachine = document.getElementById('drum-machine');
const playButton = document.getElementById('play');
const stopButton = document.getElementById('stop');
const randomBassButton = document.getElementById('random-bass');
const downloadAudioButton = document.getElementById('download-audio');
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

let isPlaying = false;
let currentNote = 0;
let tempo = 120;
let swing = 0; // Swing percentage (0-100)
let timerID;
let swingOffset = 0;

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
  acid: new Array(32).fill(false)
};

// Mute and Solo States
const mutedInstruments = {
    kick: false,
    snare: false,
    hihatClosed: false,
    hihatOpened: false,
    clap: false,
    bass1: false,
    tom: false,
    perc1: false,
    perc2: false,
    perc3: false,
    perc4: false,
    perc5: false,
    perc6: false,
  acid: false
};

const soloedInstruments = {
    kick: false,
    snare: false,
    hihatClosed: false,
    hihatOpened: false,
    clap: false,
    bass1: false,
    tom: false,
    perc1: false,
    perc2: false,
    perc3: false,
    perc4: false,
    perc5: false,
    perc6: false,
  acid: false
};

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
  acid: 0.6
};

// ADSR Parameters (only for Kick Drum and Hi-Hat)
const adsrParameters = {
    kick: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 },
    hihatClosed: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.3 },
    hihatOpened: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.3 }
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
masterLowpass.frequency.value = lowpassSlider.value; // Initial value from slider

// Master High-Pass Filter
const masterHighpass = audioCtx.createBiquadFilter();
masterHighpass.type = 'highpass';
masterHighpass.frequency.value = highpassSlider.value; // Initial value from slider

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
    if (instrument === 'bass1') {
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

// Preload Audio Buffers
loadSounds();

// Generate Pads
function generatePads() {
    drumMachine.innerHTML = '';
    for (let i = 0; i < 32; i++) { // 32 pads
        const pad = document.createElement('div');
        pad.classList.add('pad');
        pad.dataset.step = i + 1;
        pad.dataset.index = i;

        if (currentInstrument === 'bass1') {
            pad.addEventListener('click', () => {
                const step = sequences[currentInstrument][i];
                step.active = !step.active;
                pad.classList.toggle('active', step.active);
                updateBassKnob(pad, i);
            });
        } else {
            pad.addEventListener('click', () => {
                sequences[currentInstrument][i] = !sequences[currentInstrument][i];
                pad.classList.toggle('active', sequences[currentInstrument][i]);
            });
        }

        drumMachine.appendChild(pad);

        if (currentInstrument === 'bass1') {
            // Create pitch knob for bass
            const knobContainer = document.createElement('div');
            knobContainer.classList.add('pitch-knob');
            pad.appendChild(knobContainer);

            const knob = new Nexus.Dial(knobContainer, {
                size: [40, 40],
                min: -24,
                max: 24,
                step: 1,
                value: sequences[currentInstrument][i].pitch
            });

            knob.on('change', (v) => {
                sequences[currentInstrument][i].pitch = v;
            });

            knob.colorize("fill", "#00e676");
            knob.colorize("accent", "#00e676");
        }
    }
    updatePads();
}

// Update Pads
function updatePads() {
    const pads = document.querySelectorAll('.pad');
    pads.forEach((pad, index) => {
        if (currentInstrument === 'bass1') {
            pad.classList.toggle('active', sequences[currentInstrument][index].active);
        } else {
            pad.classList.toggle('active', sequences[currentInstrument][index]);
        }
    });
}

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
const masterVolumeSlider = document.getElementById('master-volume');
masterVolumeSlider.addEventListener('input', () => {
    masterGain.gain.value = parseFloat(masterVolumeSlider.value) * 0.8; // Adjust for initial 0.8
});

// ADSR Slider Events (only for Kick Drum and Hi-Hat)
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

        if (instrument === 'bass1') {
            const step = sequences[instrument][beatNumber];
            if (step.active) {
                const pitch = Math.pow(2, step.pitch / 12);
                playSound(buffers[instrument], adjustedTime, pitch, null, instrument, null);
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
    const firstHalf = [];
    for (let i = 0; i < 16; i++) { // Generate 16 random steps
        firstHalf.push({
            active: Math.random() < 0.5,
            pitch: Math.floor(Math.random() * 49) - 6 // Random pitch between -24 and +24
        });
    }
    // Duplicate the 16 steps to make 32 steps
    sequences.bass1 = [...firstHalf, ...firstHalf];
    if (currentInstrument === 'bass1') {
        generatePads();
    }
});
// Random Bass Line Generator
randomBassButton.addEventListener('click', () => {
    const firstHalf = [];
    for (let i = 0; i < 16; i++) { // Generate 16 random steps
        firstHalf.push({
            active: Math.random() < 0.5,
            pitch: Math.floor(Math.random() * 49) - 6 // Random pitch between -24 and +24
        });
    }
    // Duplicate the 16 steps to make 32 steps
    sequences.bass1 = [...firstHalf, ...firstHalf];
    if (currentInstrument === 'acid') {
        generatePads();
    }
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

// Update Bass Knob Display
function updateBassKnob(pad, index) {
    // No action needed as the knob is already handled by NexusUI
}

// Initialize
async function init() {
    await loadSounds();
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
}

init();

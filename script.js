// AudioContext Setup
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// Define which instruments should be mono
const monoInstruments = ['kick', 'snare', 'hihatClosed', 'hihatOpened', 'clap', 'midTom'];

// Sound URLs
const sounds = {
    kick: 'https://cdn.freesound.org/previews/348/348054_6244580-lq.mp3',
    snare: 'https://cdn.freesound.org/previews/25/25666_48671-lq.mp3',
    hihatClosed: 'https://cdn.freesound.org/previews/638/638654_433684-lq.mp3',
    hihatOpened: 'https://cdn.freesound.org/previews/627/627344_13191763-lq.mp3',
    clap: 'https://cdn.freesound.org/previews/244/244568_165785-lq.mp3',
    bassSynth: 'https://cdn.freesound.org/previews/711/711461_15225418-lq.mp3',
    midTom: 'https://cdn.freesound.org/previews/443/443181_6979693-lq.mp3',
};

const buffers = {};

// Preload Audio Buffers and Convert to Mono if needed
async function loadSounds() {
    const keys = Object.keys(sounds);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const url = sounds[key];
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
    }
}

// Variables
let currentInstrument = 'kick';
const instrumentButtons = document.querySelectorAll('.instrument-button');
const muteButtons = document.querySelectorAll('.mute-button');
const volumeSliders = document.querySelectorAll('.volume-slider');
const drumMachine = document.getElementById('drum-machine');
const playButton = document.getElementById('play');
const stopButton = document.getElementById('stop');
const randomBassButton = document.getElementById('random-bass');
// Removed Export buttons
// const exportAudioButton = document.getElementById('export-audio');
// const exportMidiButton = document.getElementById('export-midi');
const tempoSlider = document.getElementById('tempo');
const bpmDisplay = document.getElementById('bpm-display');
const showInstructionsButton = document.getElementById('show-instructions');
const modal = document.getElementById('modal');
const closeModalButton = document.getElementById('close-modal');
let isPlaying = false;
let currentNote = 0;
let tempo = 120;
let timerID;

const sequences = {
    kick: new Array(16).fill(false),
    snare: new Array(16).fill(false),
    hihatClosed: new Array(16).fill(false),
    hihatOpened: new Array(16).fill(false),
    clap: new Array(16).fill(false),
    bassSynth: new Array(16).fill(false).map(() => ({ active: false, pitch: 0 })),
    midTom: new Array(16).fill(false),
};

const mutedInstruments = {
    kick: false,
    snare: false,
    hihatClosed: false,
    hihatOpened: false,
    clap: false,
    bassSynth: false,
    midTom: false,
};

const instrumentVolumes = {
    kick: 0.8,
    snare: 0.7,
    hihatClosed: 0.6,
    hihatOpened: 0.6,
    clap: 0.7,
    bassSynth: 0.5,
    midTom: 0.7,
};

// ADSR Parameters (only for Kick Drum and Hi-Hat)
const adsrParameters = {
    kick: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5 },
    hihatClosed: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.3 },
    hihatOpened: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.3 },
    // Removed ADSR for Bass Synth
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

masterGain.connect(masterCompressor).connect(audioCtx.destination);

// Create per-instrument gain nodes
const instrumentGainNodes = {};
Object.keys(instrumentVolumes).forEach(instrument => {
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = instrumentVolumes[instrument];
    gainNode.connect(masterGain);
    instrumentGainNodes[instrument] = gainNode;
});

// Preload Audio Buffers
loadSounds();

// Generate Pads
function generatePads() {
    drumMachine.innerHTML = '';
    for (let i = 0; i < 16; i++) {
        const pad = document.createElement('div');
        pad.classList.add('pad');
        pad.dataset.step = i + 1;
        pad.dataset.index = i;

        if (currentInstrument === 'bassSynth') {
            pad.addEventListener('click', () => {
                const step = sequences.bassSynth[i];
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

        if (currentInstrument === 'bassSynth') {
            const knobContainer = document.createElement('div');
            knobContainer.classList.add('pitch-knob');
            pad.appendChild(knobContainer);

            const knob = new Nexus.Dial(knobContainer, {
                size: [40, 40],
                min: -12,
                max: 12,
                step: 1,
                value: sequences.bassSynth[i].pitch
            });

            knob.on('change', (v) => {
                sequences.bassSynth[i].pitch = v;
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
        if (currentInstrument === 'bassSynth') {
            pad.classList.toggle('active', sequences.bassSynth[index].active);
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
    });
});

// Volume Slider Events
volumeSliders.forEach(slider => {
    slider.addEventListener('input', () => {
        const instrument = slider.dataset.instrument;
        instrumentVolumes[instrument] = parseFloat(slider.value);
        instrumentGainNodes[instrument].gain.value = instrumentVolumes[instrument];
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
    currentNote = (currentNote + 1) % 16;
}

// Schedule Note
function scheduleNote(beatNumber, time) {
    // Highlight the pads
    const pads = document.querySelectorAll('.pad');
    pads.forEach((pad, index) => {
        pad.classList.toggle('playing', index === beatNumber);
    });

    // Make sure only one hi-hat plays at a time
    if (sequences.hihatClosed[beatNumber] && sequences.hihatOpened[beatNumber]) {
        sequences.hihatOpened[beatNumber] = false;
    }

    // Play sounds
    Object.keys(sequences).forEach(instrument => {
        if (mutedInstruments[instrument]) return;

        if (instrument === 'bassSynth') {
            const step = sequences.bassSynth[beatNumber];
            if (step.active) {
                const pitch = Math.pow(2, step.pitch / 12);
                // No ADSR for Bass Synth
                playSound(buffers[instrument], time, pitch, null, instrument, null);
            }
        } else if (sequences[instrument][beatNumber]) {
            let adsr = null;
            if (adsrParameters[instrument]) {
                adsr = adsrParameters[instrument];
            }
            playSound(buffers[instrument], time, 1, null, instrument, adsr);
        }
    });
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
    sequences.bassSynth.forEach(step => {
        step.active = Math.random() < 0.5;
        step.pitch = Math.floor(Math.random() * 25) - 12; // Random pitch between -12 and +12
    });
    if (currentInstrument === 'bassSynth') {
        generatePads();
    }
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
    document.getElementById('current-year').textContent = new Date().getFullYear();
}

init();

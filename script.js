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
    midTom: 'https://cdn.freesound.org/previews/443/443181_6979693-lq.mp3'
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
const downloadAudioButton = document.getElementById('download-audio'); // New button
const tempoSlider = document.getElementById('tempo');
const bpmDisplay = document.getElementById('bpm-display');
const swingSlider = document.getElementById('swing');
const swingDisplay = document.getElementById('swing-display');
const lowpassSlider = document.getElementById('lowpass-filter');
const lowpassDisplay = document.getElementById('lowpass-display');
const highpassSlider = document.getElementById('highpass-filter');
const highpassDisplay = document.getElementById('highpass-display');
const showInstructionsButton = document.getElementById('show-instructions');
const modal = document.getElementById('modal');
const closeModalButton = document.getElementById('close-modal');
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

// Sequences
const sequences = {
    kick: new Array(32).fill(false),
    snare: new Array(32).fill(false),
    hihatClosed: new Array(32).fill(false),
    hihatOpened: new Array(32).fill(false),
    clap: new Array(32).fill(false),
    bassSynth: new Array(32).fill(false).map(() => ({ active: false, pitch: 0 })),
    midTom: new Array(32).fill(false)
};

// Mute and Solo States
const mutedInstruments = {
    kick: false,
    snare: false,
    hihatClosed: false,
    hihatOpened: false,
    clap: false,
    bassSynth: false,
    midTom: false
};

const soloedInstruments = {
    kick: false,
    snare: false,
    hihatClosed: false,
    hihatOpened: false,
    clap: false,
    bassSynth: false,
    midTom: false
};

// Instrument Volumes
const instrumentVolumes = {
    kick: 0.8,
    snare: 0.7,
    hihatClosed: 0.6,
    hihatOpened: 0.6,
    clap: 0.7,
    bassSynth: 0.5,
    midTom: 0.7
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

// Connect the audio nodes: Master Gain -> High-Pass Filter -> Low-Pass Filter -> Compressor -> Destination
masterGain.connect(masterHighpass).connect(masterLowpass).connect(masterCompressor).connect(audioCtx.destination);

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
    for (let i = 0; i < 32; i++) { // 32 pads
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

    // Make sure only one hi-hat plays at a time
    if (sequences.hihatClosed[beatNumber] && sequences.hihatOpened[beatNumber]) {
        sequences.hihatOpened[beatNumber] = false;
    }

    // Calculate swing offset for even beats
    let adjustedTime = time;
    if ((beatNumber % 2) === 1) { // Even step in 0-based index
        adjustedTime += swingOffset;
    }

    // Play sounds
    Object.keys(sequences).forEach(instrument => {
        if (mutedInstruments[instrument] || (isAnySoloedFunction() && !soloedInstruments[instrument])) return;

        if (instrument === 'bassSynth') {
            const step = sequences.bassSynth[beatNumber];
            if (step.active) {
                const pitch = Math.pow(2, step.pitch / 12);
                // No ADSR for Bass Synth
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
            pitch: Math.floor(Math.random() * 25) - 12 // Random pitch between -12 and +12
        });
    }
    // Duplicate the 16 steps to make 32 steps
    sequences.bassSynth = [...firstHalf, ...firstHalf];
    if (currentInstrument === 'bassSynth') {
        generatePads();
    }
});

// Download Audio Functionality
downloadAudioButton.addEventListener('click', async () => {
    // Calculate total duration: 32 steps * 0.25 beats per step * seconds per beat = 8 * (60 / tempo)
    const totalDuration = 8 * (60 / tempo); // 8 beats
    const offlineCtx = new OfflineAudioContext(2, audioCtx.sampleRate * totalDuration, audioCtx.sampleRate);

    // Create master gain
    const master = offlineCtx.createGain();
    master.gain.value = 0.8;

    // Create compressor
    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, offlineCtx.currentTime);
    compressor.knee.setValueAtTime(30, offlineCtx.currentTime);
    compressor.ratio.setValueAtTime(12, offlineCtx.currentTime);
    compressor.attack.setValueAtTime(0, offlineCtx.currentTime);
    compressor.release.setValueAtTime(0.25, offlineCtx.currentTime);

    // Create master low-pass filter
    const offlineLowpass = offlineCtx.createBiquadFilter();
    offlineLowpass.type = 'lowpass';
    offlineLowpass.frequency.value = lowpassSlider.value;

    // Create master high-pass filter
    const offlineHighpass = offlineCtx.createBiquadFilter();
    offlineHighpass.type = 'highpass';
    offlineHighpass.frequency.value = highpassSlider.value;

    // Connect the audio nodes: Master Gain -> High-Pass Filter -> Low-Pass Filter -> Compressor -> Destination
    master.connect(offlineHighpass).connect(offlineLowpass).connect(compressor).connect(offlineCtx.destination);

    // Create per-instrument gain nodes
    const offlineGainNodes = {};
    Object.keys(instrumentVolumes).forEach(instrument => {
        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = instrumentVolumes[instrument];
        gainNode.connect(master);
        offlineGainNodes[instrument] = gainNode;
    });

    // Function to play sound in offline context
    function playOfflineSound(buffer, time, playbackRate = 1, duration = null, instrument = null, adsr = null) {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;

        const gainNode = offlineCtx.createGain();

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
        gainNode.connect(offlineGainNodes[instrument]);
        source.start(time);
        if (duration) {
            source.stop(time + duration + (adsr ? adsr.release : 0));
        }
    }

    // Schedule all notes
    for (let i = 0; i < 32; i++) { // 32 steps
        const beatTime = (i * (60 / tempo)) / 4; // 32 steps per measure

        // Apply swing
        let adjustedTime = beatTime;
        if ((i % 2) === 1) { // Even step in 0-based index
            adjustedTime += swing / 100 * (60 / tempo) / 2;
        }

        Object.keys(sequences).forEach(instrument => {
            if (mutedInstruments[instrument] || (isAnySoloedFunction() && !soloedInstruments[instrument])) return;

            if (instrument === 'bassSynth') {
                const step = sequences.bassSynth[i];
                if (step.active) {
                    const pitch = Math.pow(2, step.pitch / 12);
                    // No ADSR for Bass Synth
                    playOfflineSound(buffers[instrument], adjustedTime, pitch, null, instrument, null);
                }
            } else {
                if (sequences[instrument][i]) {
                    let adsr = null;
                    if (adsrParameters[instrument]) {
                        adsr = adsrParameters[instrument];
                    }
                    playOfflineSound(buffers[instrument], adjustedTime, 1, null, instrument, adsr);
                }
            }
        });
    }

    // Render the audio
    const renderedBuffer = await offlineCtx.startRendering();

    // Convert to WAV and download
    const wavBlob = bufferToWave(renderedBuffer, renderedBuffer.length);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'drum-machine-sequence.wav';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
});

// Function to convert buffer to WAV
function bufferToWave(abuffer, len) {
    const numOfChan = abuffer.numberOfChannels;
    const length = len * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let i;        // Changed from const to let
    let sample;   // Changed from const to let
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16);         // length = 16
    setUint16(1);          // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                     // block-align
    setUint16(16);                                // 16-bit (hardcoded in this demo)

    setUint32(0x61746164); // "data" - chunk
    setUint32(len * numOfChan * 2); // chunk length

    // write interleaved data
    for (i = 0; i < abuffer.numberOfChannels; i++) {
        channels.push(abuffer.getChannelData(i));
    }

    while (pos < len) {
        for (i = 0; i < numOfChan; i++) { // interleave channels
            sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF; // scale to 16-bit signed int
            view.setInt16(offset, sample, true); // write 16-bit sample
            offset += 2;
        }
        pos++;
    }

    return new Blob([buffer], { type: "audio/wav" });

    function setUint16(data) {
        view.setUint16(offset, data, true);
        offset += 2;
    }

    function setUint32(data) {
        view.setUint32(offset, data, true);
        offset += 4;
    }
}

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

// Check if any instrument is soloed
function isAnySoloedFunction() {
    return Object.values(soloedInstruments).some(val => val);
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
    document.getElementById('current-year').textContent = new Date().getFullYear();
}

init();

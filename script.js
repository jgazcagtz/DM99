import {
  AudioEngine,
  AUDIO_PRESET_REGISTRY,
  DEFAULT_KIT_ID,
  KIT_SNAPSHOTS,
  TRACK_IDS,
  TRACK_REGISTRY,
} from './src/audio-engine.js';
import { listAudioPresets } from './src/instruments.js';
import {
  createDefaultProjectState,
  normalizeProjectState,
  normalizeStep,
} from './src/project-state.js';
import {
  applyPatternTransform,
  createSeededRandom,
  generatePattern,
} from './src/pattern-engine.js';
import {
  GENERATED_DRUM_TRACK_IDS,
  PATTERN_SLOT_IDS,
  SCALE_IDS,
} from './src/pattern-constants.js';
import { openProjectStore } from './src/project-store.js';
import { openSamplerStore } from './src/sampler-store.js';

const SEQUENCE_LENGTH = 32;
const HISTORY_LIMIT = 8;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.1;
const AUTOSAVE_ID = 'dm99-autosave';
const LAST_PROJECT_KEY = 'dm99-last-project-id';
const TONAL_TRACK_IDS = Object.freeze(['bass1', 'acid', 'synth', 'sub', 'tr808', 'fmBass', 'pluck', 'amPad']);
const PERFORMANCE_KEYS = Object.freeze({
  KeyA: 'kick', KeyS: 'snare', KeyD: 'clap', KeyF: 'hihatClosed',
  KeyG: 'hihatOpened', KeyH: 'tom', KeyJ: 'perc1', KeyK: 'perc2',
  KeyL: 'crash', Semicolon: 'ride', KeyQ: 'bass1', KeyW: 'acid',
  KeyE: 'sub', KeyR: 'fmBass', KeyT: 'pluck', KeyY: 'amPad',
});
const GM_NOTE_TO_TRACK = Object.freeze({
  36: 'kick', 38: 'snare', 39: 'clap', 42: 'hihatClosed', 46: 'hihatOpened',
  45: 'tom', 37: 'rimshot', 56: 'cowbell', 49: 'crash', 51: 'ride',
});
const SCALE_INTERVALS = Object.freeze({
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
});

const $ = id => document.getElementById(id);
const deepClone = value => globalThis.structuredClone
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

let project = createDefaultProjectState();
let currentTrackId = 'kick';
let selectedStepIndex = null;
let visibleStepPage = 0;
let audioEngine = null;
let audioStarting = null;
let projectStore = null;
let samplerStore = null;
let currentProjectId = null;
let historyStack = [];
let futureStack = [];
let variationCandidates = [];
let projectChangeToken = 0;
let lockedLanes = new Set();
let autosavePromise = null;
let toastTimer = 0;
let installPrompt = null;
let playbackRandom = createSeededRandom('dm99-playback');

let transportRunning = false;
let transportStarting = false;
let schedulerTimer = 0;
let animationFrame = 0;
let nextStepTime = 0;
let transportStep = 0;
let audibleStep = -1;
let visualQueue = [];

let activeSampleBuffer = null;
let activeSampleFile = null;
let sampleRestoreToken = 0;
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let midiAccess = null;
let captureEvents = [];

function showToast(message, { error = false } = {}) {
  const toast = $('toast');
  toast.textContent = message;
  toast.style.borderColor = error ? 'var(--danger)' : '';
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function setStatus(message, type = 'info') {
  $('audio-status').textContent = message;
  $('audio-status-dot').classList.toggle('ready', type === 'ready');
}

function setAiStatus(message, source = 'Local engine') {
  $('ai-status').textContent = message;
  $('pattern-source').textContent = source;
  $('engine-source').textContent = source.replace(' engine', '');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the no-permission browser fallback.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  textarea.remove();
  return copied;
}

function safeFilename(value, extension) {
  const stem = String(value || 'dm99-project')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'dm99-project';
  return `${stem}.${extension}`;
}

function formatStorageSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function createProceduralSampleMetadata() {
  return {
    id: '', name: '', url: '', source: 'procedural', mimeType: '', license: '',
    attribution: '', start: 0, end: 1, tune: 0, mode: 'one-shot',
  };
}

function rememberLastProject(id) {
  try {
    if (id && id !== AUTOSAVE_ID) localStorage.setItem(LAST_PROJECT_KEY, String(id));
    else localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // Project storage may still work when direct localStorage access is unavailable.
  }
}

function readLastProject() {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) || '';
  } catch {
    return '';
  }
}

function currentSequences() {
  return project.sequences;
}

function normalizeUiProject(value) {
  const normalized = normalizeProjectState(value);
  if (normalized.sequenceLength !== SEQUENCE_LENGTH) {
    throw new Error(`This DM99 groovebox supports ${SEQUENCE_LENGTH}-step projects. Export the source project before converting its length.`);
  }
  return normalized;
}

function clearVariationCandidates() {
  variationCandidates = [];
  $('variation-list')?.replaceChildren();
}

function syncActivePattern(draft = project) {
  draft.patterns ||= {};
  draft.patterns[draft.activePattern] = deepClone(draft.sequences);
}

function snapshotProject() {
  syncActivePattern(project);
  return deepClone(project);
}

function historySnapshot() {
  return JSON.stringify(snapshotProject());
}

function restoreSnapshot(snapshot, { announce = false, restoreSamples = true } = {}) {
  project = normalizeUiProject(typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot);
  coerceAudioSettings();
  projectChangeToken += 1;
  clearVariationCandidates();
  lockedLanes = new Set(Object.entries(project.locks || {}).filter(([, locked]) => locked).map(([id]) => id));
  audioEngine?.clearUserBuffers();
  applyProjectToAudio();
  if (restoreSamples) void restoreAssignedSamples();
  renderAll();
  if (announce) showToast('Project state restored');
}

function mutateProject(mutator, { history = true, render = true, autosave = true } = {}) {
  if (history) {
    historyStack.push(historySnapshot());
    if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
    futureStack = [];
  }
  mutator(project);
  projectChangeToken += 1;
  syncActivePattern(project);
  if (render) renderAll();
  if (autosave) queueAutosave();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undo').disabled = historyStack.length === 0;
  $('redo').disabled = futureStack.length === 0;
}

function undo() {
  if (!historyStack.length) return;
  futureStack.push(historySnapshot());
  restoreSnapshot(historyStack.pop());
  updateHistoryButtons();
  queueAutosave();
  showToast('Undone');
}

function redo() {
  if (!futureStack.length) return;
  historyStack.push(historySnapshot());
  restoreSnapshot(futureStack.pop());
  updateHistoryButtons();
  queueAutosave();
  showToast('Redone');
}

function queueAutosave() {
  if (!projectStore) return;
  $('autosave-status').textContent = 'Saving…';
  const name = $('project-name').value.trim() || project.projectName || 'Untitled groove';
  const id = currentProjectId || AUTOSAVE_ID;
  autosavePromise = projectStore.autosaveProject(snapshotProject(), {
    id,
    name,
    debounceMs: 650,
  });
  autosavePromise.then(record => {
    currentProjectId ||= record.id;
    $('autosave-status').textContent = projectStore.persistent ? 'Saved locally' : 'Saved for this session';
    refreshProjectList();
  }).catch(error => {
    if (error?.code === 'AUTOSAVE_CANCELLED') return;
    $('autosave-status').textContent = 'Autosave unavailable';
    console.warn('DM99 autosave failed:', error);
  });
}

function stepDurationSeconds() {
  return 60 / project.tempo / 4;
}

function isPitchedTrack(trackId) {
  const definition = TRACK_REGISTRY[trackId];
  return definition?.tags?.includes('pitched') || TONAL_TRACK_IDS.includes(trackId);
}

function setRangeOutput(inputId, outputId, formatter) {
  const input = $(inputId);
  const render = () => { $(outputId).textContent = formatter(Number(input.value)); };
  input.addEventListener('input', render);
  render();
}

function projectGeneratorControls() {
  return {
    genre: $('genre-select').value,
    energy: Number($('energy-slider').value),
    complexity: Number($('complexity-slider').value),
    syncopation: Number($('syncopation-slider').value),
    humanize: Number($('humanize-slider').value),
    seed: $('seed-input').value.trim() || 'dm99',
    length: Number($('bars-select').value) * 16,
    bpm: project.tempo,
  };
}

function renderAll() {
  renderTrackIdentity();
  renderSequencer();
  renderStepEditor();
  renderMixer();
  renderPatternSlots();
  renderProjectControls();
  updateHistoryButtons();
}

function renderTrackIdentity() {
  const track = TRACK_REGISTRY[currentTrackId];
  const readiness = audioEngine?.getTrackReadiness(currentTrackId);
  $('current-track-group').textContent = track.group;
  $('current-track-name').textContent = track.label;
  $('track-ready').textContent = readiness?.source === 'user-buffer'
    ? 'User sample'
    : readiness?.ready ? 'Audio ready' : 'Local voice';
  $('sequencer-grid').setAttribute('aria-label', `${track.label} steps`);

  const setting = project.trackSettings[currentTrackId];
  const presets = listAudioPresets(currentTrackId);
  $('preset-select').replaceChildren(...presets.map(preset => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    option.selected = preset.id === setting.presetId;
    return option;
  }));
  const laneLocked = lockedLanes.has(currentTrackId);
  $('lock-current-track').setAttribute('aria-pressed', String(laneLocked));
  $('lock-current-track').textContent = laneLocked ? 'Unlock current lane' : 'Lock current lane';
}

function renderSequencer() {
  const grid = $('sequencer-grid');
  const sequence = currentSequences()[currentTrackId];
  const activeElementIndex = Number(document.activeElement?.dataset?.index);
  const pageStart = visibleStepPage * 16;
  const selectedIsVisible = Number.isInteger(selectedStepIndex)
    && selectedStepIndex >= pageStart
    && selectedStepIndex < pageStart + 16;
  const rovingIndex = selectedIsVisible ? selectedStepIndex : pageStart;
  grid.replaceChildren(...sequence.map((step, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'step-pad';
    button.dataset.index = String(index);
    button.dataset.ratchet = String(step.ratchet);
    button.style.setProperty('--velocity', String(step.velocity));
    const page = index < 16 ? 0 : 1;
    button.classList.toggle('mobile-hidden', page !== visibleStepPage);
    button.classList.toggle('active', step.active);
    button.classList.toggle('selected', selectedStepIndex === index);
    button.classList.toggle('playing', audibleStep === index);
    button.classList.toggle('probabilistic', step.probability < 1 && step.ratchet <= 1);
    button.classList.toggle('ratcheted', step.ratchet > 1);
    button.setAttribute('aria-pressed', String(step.active));
    button.setAttribute('aria-label', `${TRACK_REGISTRY[currentTrackId].label}, step ${index + 1}, ${step.active ? 'active' : 'inactive'}, velocity ${Math.round(step.velocity * 100)} percent, probability ${Math.round(step.probability * 100)} percent, ratchet ${step.ratchet}`);
    button.tabIndex = index === rovingIndex ? 0 : -1;
    button.textContent = String(index + 1);
    button.addEventListener('click', () => toggleStep(index));
    button.addEventListener('keydown', event => handlePadKeydown(event, index));
    return button;
  }));
  if (Number.isInteger(activeElementIndex)) grid.querySelector(`[data-index="${activeElementIndex}"]`)?.focus();
  $('step-page-1').classList.toggle('active', visibleStepPage === 0);
  $('step-page-2').classList.toggle('active', visibleStepPage === 1);
  $('step-page-1').setAttribute('aria-pressed', String(visibleStepPage === 0));
  $('step-page-2').setAttribute('aria-pressed', String(visibleStepPage === 1));
}

function toggleStep(index) {
  mutateProject(draft => {
    const step = draft.sequences[currentTrackId][index];
    step.active = !step.active;
  });
  selectedStepIndex = index;
  renderSequencer();
  renderStepEditor();
  if (project.sequences[currentTrackId][index].active) previewTrack(currentTrackId, project.sequences[currentTrackId][index]);
}

function handlePadKeydown(event, index) {
  const columns = matchMedia('(max-width: 760px)').matches ? 4 : 16;
  let target = null;
  if (event.key === 'ArrowRight') target = index + 1;
  if (event.key === 'ArrowLeft') target = index - 1;
  if (event.key === 'ArrowDown') target = index + columns;
  if (event.key === 'ArrowUp') target = index - columns;
  if (target === null) return;
  event.preventDefault();
  target = Math.max(visibleStepPage * 16, Math.min((visibleStepPage + 1) * 16 - 1, target));
  selectedStepIndex = target;
  renderSequencer();
  renderStepEditor();
  $('sequencer-grid').querySelector(`[data-index="${target}"]`)?.focus();
}

function renderStepEditor() {
  const hasSelection = Number.isInteger(selectedStepIndex);
  $('step-editor-empty').classList.toggle('hidden', hasSelection);
  $('step-editor-controls').classList.toggle('hidden', !hasSelection);
  $('selected-step-label').textContent = hasSelection ? `Step ${selectedStepIndex + 1}` : 'Select a step';
  if (!hasSelection) return;
  const step = project.sequences[currentTrackId][selectedStepIndex];
  $('step-velocity').value = String(step.velocity);
  $('step-probability').value = String(step.probability);
  $('step-ratchet').value = String(step.ratchet);
  $('step-nudge').value = String(step.nudgeMs);
  $('step-pitch').value = String(step.pitch);
  $('step-scale').value = step.scale;
  $('step-accent').checked = step.accent;
  $('step-slide').checked = step.slide;
  $('velocity-output').textContent = `${Math.round(step.velocity * 100)}%`;
  $('probability-output').textContent = `${Math.round(step.probability * 100)}%`;
  $('ratchet-output').textContent = `${step.ratchet}×`;
  $('nudge-output').textContent = `${step.nudgeMs} ms`;
  $('pitch-output').textContent = `${step.pitch > 0 ? '+' : ''}${step.pitch}`;
  $('step-pitch').disabled = !isPitchedTrack(currentTrackId);
  $('step-scale').disabled = !isPitchedTrack(currentTrackId);
  $('step-slide').disabled = !isPitchedTrack(currentTrackId);
}

function renderPatternSlots() {
  $('pattern-slots').replaceChildren(...PATTERN_SLOT_IDS.map((slot, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pattern-slot';
    button.textContent = slot;
    button.title = `Pattern ${slot} — keyboard ${index + 1}`;
    button.classList.toggle('active', slot === project.activePattern);
    button.setAttribute('aria-pressed', String(slot === project.activePattern));
    button.addEventListener('click', () => selectPatternSlot(slot));
    return button;
  }));
  $('active-pattern-name').textContent = project.activePattern;
}

function selectPatternSlot(slot) {
  if (!PATTERN_SLOT_IDS.includes(slot) || slot === project.activePattern) return;
  mutateProject(draft => {
    syncActivePattern(draft);
    draft.activePattern = slot;
    draft.sequences = deepClone(draft.patterns[slot]);
  });
  selectedStepIndex = null;
  clearVariationCandidates();
  showToast(`Pattern ${slot}`);
}

function renderProjectControls() {
  $('project-name').value = project.projectName || 'Untitled groove';
  $('tempo').value = String(project.tempo);
  $('bpm-display').textContent = String(Math.round(project.tempo));
  $('swing').value = String(project.swing);
  $('swing-display').textContent = `${Math.round(project.swing)}%`;
  $('master-volume').value = String(project.effects?.masterVolume ?? 0.82);
  $('genre-select').value = project.generator.genre;
  $('energy-slider').value = String(project.generator.energy);
  $('complexity-slider').value = String(project.generator.complexity);
  $('syncopation-slider').value = String(project.generator.syncopation);
  $('humanize-slider').value = String(project.generator.humanize);
  $('seed-input').value = project.generator.seed;
  $('kit-select').value = KIT_SNAPSHOTS[project.kitId] ? project.kitId : DEFAULT_KIT_ID;
  $('lowpass-filter').value = String(project.effects?.lowpassHz ?? 20000);
  $('highpass-filter').value = String(project.effects?.highpassHz ?? 20);
  $('master-drive').value = String(project.effects?.drive ?? 0);
  $('master-delay').value = String(project.effects?.delayWet ?? 0.12);
  $('master-reverb').value = String(project.effects?.reverbWet ?? 0.08);
  $('master-eq-low').value = String(project.effects?.masterEq?.low ?? 0);
  $('master-eq-mid').value = String(project.effects?.masterEq?.mid ?? 0);
  $('master-eq-high').value = String(project.effects?.masterEq?.high ?? 0);
  $('energy-output').textContent = `${Math.round(Number($('energy-slider').value) * 100)}%`;
  $('complexity-output').textContent = `${Math.round(Number($('complexity-slider').value) * 100)}%`;
  $('syncopation-output').textContent = `${Math.round(Number($('syncopation-slider').value) * 100)}%`;
  $('humanize-output').textContent = `${Math.round(Number($('humanize-slider').value) * 100)}%`;
  $('lowpass-output').textContent = project.effects.lowpassHz >= 10000 ? `${Math.round(project.effects.lowpassHz / 1000)} kHz` : `${project.effects.lowpassHz} Hz`;
  $('highpass-output').textContent = `${project.effects.highpassHz} Hz`;
  $('drive-output').textContent = `${Math.round(project.effects.drive * 100)}%`;
  $('delay-output').textContent = `${Math.round(project.effects.delayWet * 100)}%`;
  $('reverb-output').textContent = `${Math.round(project.effects.reverbWet * 100)}%`;
  $('eq-low-output').textContent = `${Number(project.effects.masterEq.low).toFixed(1).replace('.0', '')} dB`;
  $('eq-mid-output').textContent = `${Number(project.effects.masterEq.mid).toFixed(1).replace('.0', '')} dB`;
  $('eq-high-output').textContent = `${Number(project.effects.masterEq.high).toFixed(1).replace('.0', '')} dB`;
}

function renderMixer() {
  const container = $('mixer-tracks');
  container.replaceChildren(...TRACK_IDS.map(trackId => {
    const track = TRACK_REGISTRY[trackId];
    const row = document.createElement('div');
    row.className = 'mixer-row';
    row.classList.toggle('selected', trackId === currentTrackId);

    const selectTrack = document.createElement('button');
    selectTrack.type = 'button';
    selectTrack.className = 'track-select';
    selectTrack.innerHTML = `${track.label}<small>${track.group}</small>`;
    selectTrack.setAttribute('aria-label', `Edit ${track.label}`);
    selectTrack.addEventListener('click', () => {
      currentTrackId = trackId;
      selectedStepIndex = null;
      renderAll();
      if (matchMedia('(max-width: 760px)').matches) $('mixer-dialog').close();
      $('sequencer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const presetLabel = document.createElement('label');
    presetLabel.className = 'preset-control';
    presetLabel.textContent = 'Sound';
    const presetSelect = document.createElement('select');
    presetSelect.setAttribute('aria-label', `${track.label} sound`);
    presetSelect.append(...listAudioPresets(trackId).map(preset => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      option.selected = preset.id === project.trackSettings[trackId].presetId;
      return option;
    }));
    presetSelect.addEventListener('change', () => setTrackPreset(trackId, presetSelect.value, true));
    presetLabel.append(presetSelect);

    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'mixer-toggle';
    mute.textContent = 'M';
    mute.title = `Mute ${track.label}`;
    mute.setAttribute('aria-label', `Mute ${track.label}`);
    mute.setAttribute('aria-pressed', String(project.muted[trackId]));
    mute.addEventListener('click', () => {
      mutateProject(draft => { draft.muted[trackId] = !draft.muted[trackId]; });
      audioEngine?.setTrackMute(trackId, project.muted[trackId]);
    });

    const solo = document.createElement('button');
    solo.type = 'button';
    solo.className = 'mixer-toggle';
    solo.textContent = 'S';
    solo.title = `Solo ${track.label}`;
    solo.setAttribute('aria-label', `Solo ${track.label}`);
    solo.setAttribute('aria-pressed', String(project.soloed[trackId]));
    solo.addEventListener('click', () => {
      mutateProject(draft => { draft.soloed[trackId] = !draft.soloed[trackId]; });
      audioEngine?.setTrackSolo(trackId, project.soloed[trackId]);
    });

    const volumeLabel = document.createElement('label');
    volumeLabel.className = 'volume-control';
    volumeLabel.textContent = 'Volume';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0'; volume.max = '1'; volume.step = '0.01';
    volume.value = String(project.volumes[trackId]);
    volume.setAttribute('aria-label', `${track.label} volume`);
    volume.addEventListener('input', () => {
      project.volumes[trackId] = Number(volume.value);
      audioEngine?.setTrackGain(trackId, project.volumes[trackId]);
      syncActivePattern(project);
      queueAutosave();
    });
    volumeLabel.append(volume);

    const panLabel = document.createElement('label');
    panLabel.className = 'pan-control';
    panLabel.textContent = 'Pan';
    const pan = document.createElement('input');
    pan.type = 'range'; pan.min = '-1'; pan.max = '1'; pan.step = '0.01';
    pan.value = String(project.trackSettings[trackId].pan);
    pan.setAttribute('aria-label', `${track.label} pan`);
    pan.addEventListener('input', () => {
      project.trackSettings[trackId].pan = Number(pan.value);
      audioEngine?.setTrackPan(trackId, project.trackSettings[trackId].pan);
      queueAutosave();
    });
    panLabel.append(pan);

    row.append(selectTrack, presetLabel, mute, solo, volumeLabel, panLabel);
    return row;
  }));
}

function setTrackPreset(trackId, presetId, preview = false) {
  const hadCustomSample = Boolean(project.trackSettings[trackId]?.sample?.id);
  mutateProject(draft => {
    draft.trackSettings[trackId].presetId = presetId;
    if (hadCustomSample) {
      draft.trackSettings[trackId].sample = createProceduralSampleMetadata();
    }
  }, { render: false });
  if (hadCustomSample) {
    sampleRestoreToken += 1;
    audioEngine?.clearUserBuffer(trackId);
  }
  audioEngine?.setTrackPreset(trackId, presetId);
  renderTrackIdentity();
  renderMixer();
  if (preview) previewTrack(trackId, { active: true, velocity: 0.86, probability: 1 });
}

function applyKit(kitId) {
  const kit = KIT_SNAPSHOTS[kitId] || KIT_SNAPSHOTS[DEFAULT_KIT_ID];
  mutateProject(draft => {
    draft.kitId = kit.id;
    Object.entries(kit.presets).forEach(([trackId, presetId]) => {
      draft.trackSettings[trackId].presetId = presetId;
    });
  });
  audioEngine?.applyKit(kit.id);
  const customCount = TRACK_IDS.filter(trackId => project.trackSettings[trackId]?.sample?.id).length;
  showToast(customCount ? `${kit.name} kit loaded · ${customCount} custom sample${customCount === 1 ? '' : 's'} kept` : `${kit.name} kit loaded`);
}

async function ensureAudio() {
  if (audioEngine?.status === 'ready') {
    await audioEngine.resume();
    return audioEngine;
  }
  if (audioStarting) return audioStarting;
  setStatus('Starting 26 local engines…');
  $('enable-audio').disabled = true;
  audioStarting = (async () => {
    try {
      audioEngine ||= new AudioEngine({
        initialKit: KIT_SNAPSHOTS[project.kitId] ? project.kitId : DEFAULT_KIT_ID,
        random: () => playbackRandom(),
        masterGain: project.effects?.masterVolume ?? 0.82,
      });
      await audioEngine.initializeFromGesture();
      applyProjectToAudio();
      const samples = await restoreAssignedSamples();
      const readiness = audioEngine.getReadinessSnapshot();
      const readyCount = Object.values(readiness).filter(item => item.ready).length;
      if (readyCount !== TRACK_IDS.length) throw new Error(`Only ${readyCount} of ${TRACK_IDS.length} tracks initialized.`);
      setStatus(samples.missing
        ? `${readyCount}/${TRACK_IDS.length} local voices ready · ${samples.missing} sample fallback${samples.missing === 1 ? '' : 's'}`
        : `${readyCount}/${TRACK_IDS.length} local voices ready`, 'ready');
      $('enable-audio').textContent = 'Audio ready';
      $('enable-audio').classList.remove('primary');
      $('enable-audio').classList.add('ghost');
      $('audio-status-dot').classList.add('ready');
      renderAll();
      return audioEngine;
    } catch (error) {
      const failedEngine = audioEngine;
      audioEngine = null;
      try { await failedEngine?.dispose(); } catch { /* best-effort failed-context cleanup */ }
      setStatus('Audio could not start');
      $('enable-audio').disabled = false;
      showToast(error.message || 'Audio initialization failed', { error: true });
      throw error;
    } finally {
      audioStarting = null;
      if ($('enable-audio').textContent !== 'Audio ready') $('enable-audio').disabled = false;
    }
  })();
  return audioStarting;
}

function applyProjectToAudio() {
  if (!audioEngine || audioEngine.status !== 'ready') return;
  if (KIT_SNAPSHOTS[project.kitId]) audioEngine.applyKit(project.kitId);
  TRACK_IDS.forEach(trackId => {
    audioEngine.setTrackPreset(trackId, project.trackSettings[trackId].presetId);
    audioEngine.setTrackGain(trackId, project.volumes[trackId]);
    audioEngine.setTrackPan(trackId, project.trackSettings[trackId].pan);
    audioEngine.setTrackMute(trackId, project.muted[trackId]);
    audioEngine.setTrackSolo(trackId, project.soloed[trackId]);
    audioEngine.setTrackChokeGroup?.(trackId, project.trackSettings[trackId].chokeGroup);
  });
  const effects = project.effects || {};
  audioEngine.setMasterGain(effects.masterVolume ?? 0.82);
  audioEngine.setMasterFilter({ highpass: effects.highpassHz ?? 20, lowpass: effects.lowpassHz ?? 20000 });
  if (effects.masterEq) audioEngine.setMasterEQ(effects.masterEq);
  audioEngine.setDelay({ wet: effects.delayWet ?? 0.12 });
  audioEngine.setReverb({ wet: effects.reverbWet ?? 0.08 });
  const drive = effects.drive ?? 0;
  audioEngine.setCompressor({ threshold: -24 - drive * 18, ratio: 6 + drive * 10 });
}

async function previewTrack(trackId = currentTrackId, step = {}) {
  try {
    const engine = await ensureAudio();
    engine.preview(trackId, {
      pitch: step.pitch ?? 0,
      velocity: step.velocity ?? 0.86,
      accent: step.accent ?? false,
      slide: step.slide ?? false,
      ratchet: Math.min(2, step.ratchet ?? 1),
      presetId: project.trackSettings[trackId].presetId,
    });
  } catch {
    // ensureAudio already reports the failure.
  }
}

function swingDelaySeconds(step) {
  if (step % 2 === 0) return 0;
  return (project.swing / 75) * stepDurationSeconds() * 0.5;
}

async function startTransport() {
  if (transportRunning || transportStarting) return;
  transportStarting = true;
  try {
    const engine = await ensureAudio();
    playbackRandom = createSeededRandom(`${project.generator.seed}:${project.activePattern}:playback`);
    transportRunning = true;
    transportStep = 0;
    audibleStep = -1;
    visualQueue = [];
    nextStepTime = engine.context.currentTime + 0.055;
    $('play').classList.add('active');
    $('play').textContent = 'Playing';
    schedulerTick();
    visualTick();
  } catch {
    stopTransport();
  } finally {
    transportStarting = false;
  }
}

function schedulerTick() {
  if (!transportRunning || !audioEngine?.context) return;
  const context = audioEngine.context;
  const duration = stepDurationSeconds();
  while (nextStepTime < context.currentTime + SCHEDULE_AHEAD_SECONDS) {
    const delay = swingDelaySeconds(transportStep);
    const scheduledTime = nextStepTime + delay;
    for (const trackId of TRACK_IDS) {
      const step = project.sequences[trackId][transportStep];
      if (!step?.active) continue;
      audioEngine.scheduleStep(trackId, step, scheduledTime, {
        stepDuration: duration,
        presetId: project.trackSettings[trackId].presetId,
      });
    }
    visualQueue.push({ step: transportStep, time: scheduledTime });
    nextStepTime += duration;
    transportStep = (transportStep + 1) % project.sequenceLength;
  }
  schedulerTimer = setTimeout(schedulerTick, LOOKAHEAD_MS);
}

function visualTick() {
  if (!transportRunning || !audioEngine?.context) return;
  const now = audioEngine.context.currentTime;
  while (visualQueue.length && visualQueue[0].time <= now + 0.008) {
    audibleStep = visualQueue.shift().step;
    updatePlayheadOnly();
  }
  animationFrame = requestAnimationFrame(visualTick);
}

function updatePlayheadOnly() {
  $('sequencer-grid').querySelectorAll('.step-pad.playing').forEach(pad => pad.classList.remove('playing'));
  $('sequencer-grid').querySelector(`[data-index="${audibleStep}"]`)?.classList.add('playing');
}

function stopTransport() {
  transportRunning = false;
  transportStarting = false;
  clearTimeout(schedulerTimer);
  cancelAnimationFrame(animationFrame);
  visualQueue = [];
  audibleStep = -1;
  audioEngine?.stop();
  $('play').classList.remove('active');
  $('play').textContent = 'Play';
  updatePlayheadOnly();
}

function parsePromptIntoControls(text) {
  const prompt = String(text || '').toLowerCase();
  const genreMatchers = [
    ['drum & bass', 'dnb'], ['drum and bass', 'dnb'], ['dnb', 'dnb'],
    ['deep house', 'house'], ['house', 'house'], ['techno', 'techno'],
    ['trance', 'trance'], ['electro', 'electro'], ['industrial', 'industrial'],
    ['acid', 'acid'], ['ambient', 'ambient'],
  ];
  const matchedGenre = genreMatchers.find(([phrase]) => prompt.includes(phrase));
  if (matchedGenre) $('genre-select').value = matchedGenre[1];

  const adjust = (id, amount) => {
    const input = $(id);
    input.value = String(clamp(Number(input.value) + amount, 0, 1));
    input.dispatchEvent(new Event('input'));
  };
  if (/hard|heavy|intense|rave|peak/.test(prompt)) adjust('energy-slider', 0.2);
  if (/soft|gentle|chill|minimal/.test(prompt)) adjust('energy-slider', -0.25);
  if (/busy|complex|wild|glitch/.test(prompt)) adjust('complexity-slider', 0.25);
  if (/simple|sparse|less/.test(prompt)) adjust('complexity-slider', -0.22);
  if (/syncop|broken|offbeat|funk/.test(prompt)) adjust('syncopation-slider', 0.25);
  if (/straight|steady|four on/.test(prompt)) adjust('syncopation-slider', -0.25);
  if (/human|loose|organic|shuffle/.test(prompt)) adjust('humanize-slider', 0.2);
  if (/tight|machine|precise/.test(prompt)) adjust('humanize-slider', -0.2);
  if (/dark|deep/.test(prompt)) $('kit-select').value = prompt.includes('house') ? 'deep-house' : 'industrial';
  if (/bright|uplift|wide/.test(prompt)) $('kit-select').value = 'trance';
}

function expandGeneratedTrack(track, targetLength = SEQUENCE_LENGTH) {
  if (track.length === targetLength) return track.map(normalizeStep);
  return Array.from({ length: targetLength }, (_, index) => normalizeStep(track[index % track.length]));
}

function addTonalVariation(sequences, controls, variationIndex) {
  const random = createSeededRandom(`${controls.seed}:tonal:${variationIndex}:${controls.genre}`);
  const scaleId = controls.genre === 'dnb' || controls.genre === 'acid' ? 'phrygian' : controls.genre === 'house' ? 'dorian' : 'minor';
  const scale = SCALE_INTERVALS[scaleId];
  const root = controls.genre === 'dnb' ? -5 : controls.genre === 'trance' ? 5 : 0;
  const kickSteps = sequences.kick.map((step, index) => step.active ? index : -1).filter(index => index >= 0);

  const clearTrack = trackId => {
    if (lockedLanes.has(trackId)) return;
    sequences[trackId] = sequences[trackId].map(() => normalizeStep({ scale: scaleId }));
  };
  TONAL_TRACK_IDS.forEach(clearTrack);

  const bassTrack = controls.genre === 'acid' ? 'acid' : controls.genre === 'dnb' ? 'sub' : 'bass1';
  if (!lockedLanes.has(bassTrack)) {
    const candidates = kickSteps.length ? kickSteps : [0, 4, 8, 12, 16, 20, 24, 28];
    candidates.forEach((stepIndex, index) => {
      if (index % 2 && controls.complexity < 0.42) return;
      const degree = Math.floor(random() * Math.min(scale.length, 4));
      sequences[bassTrack][stepIndex] = normalizeStep({
        active: true,
        pitch: root + scale[degree] - (bassTrack === 'sub' ? 12 : 0),
        scale: scaleId,
        velocity: 0.68 + random() * 0.28,
        probability: index % 3 === 0 ? 1 : 0.78 + controls.energy * 0.2,
        nudgeMs: Math.round((random() - 0.5) * controls.humanize * 30),
        accent: index % 4 === 0,
        slide: controls.genre === 'acid' && random() < controls.complexity * 0.5,
      });
    });
  }

  if ((controls.genre === 'trance' || controls.genre === 'acid' || controls.complexity > 0.62) && !lockedLanes.has('pluck')) {
    for (let step = variationIndex % 2; step < SEQUENCE_LENGTH; step += controls.genre === 'trance' ? 2 : 4) {
      const degree = (step / 2 + variationIndex) % scale.length;
      sequences.pluck[step] = normalizeStep({
        active: true,
        pitch: root + 12 + scale[degree],
        scale: scaleId,
        velocity: 0.46 + controls.energy * 0.32,
        probability: 0.78 + controls.complexity * 0.2,
        nudgeMs: Math.round((random() - 0.5) * controls.humanize * 24),
      });
    }
  }

  if (controls.genre === 'ambient' && !lockedLanes.has('amPad')) {
    [0, 8, 16, 24].forEach((step, index) => {
      sequences.amPad[step] = normalizeStep({
        active: true,
        pitch: root + scale[(index * 2) % scale.length],
        scale: scaleId,
        velocity: 0.48,
        probability: 1,
        slide: true,
      });
    });
  } else if (!lockedLanes.has('synth')) {
    [4, 12, 20, 28].forEach((step, index) => {
      if (random() > 0.45 + controls.energy * 0.4) return;
      sequences.synth[step] = normalizeStep({
        active: true,
        pitch: root + 12 + scale[(index * 2 + variationIndex) % scale.length],
        scale: scaleId,
        velocity: 0.56 + controls.energy * 0.25,
        probability: 0.9,
        accent: index === 3,
      });
    });
  }
}

function createVariationSequences(controls, variationIndex) {
  const variation = ['a', 'b', 'c'][variationIndex] || 'a';
  const generated = generatePattern({
    ...controls,
    variation,
    locks: Object.fromEntries([...lockedLanes].map(id => [id, true])),
    currentPattern: project.sequences,
  });
  const sequences = deepClone(project.sequences);
  GENERATED_DRUM_TRACK_IDS.forEach(trackId => {
    if (lockedLanes.has(trackId)) return;
    sequences[trackId] = expandGeneratedTrack(generated.pattern[trackId]);
  });
  addTonalVariation(sequences, controls, variationIndex);
  return { sequences, generated };
}

function generateVariations() {
  parsePromptIntoControls($('prompt-input').value);
  const controls = projectGeneratorControls();
  if (KIT_SNAPSHOTS[$('kit-select').value] && $('kit-select').value !== project.kitId) {
    applyKit($('kit-select').value);
  }
  variationCandidates = [0, 1, 2].map(index => ({
    ...createVariationSequences(controls, index),
    contextToken: projectChangeToken,
    patternSlot: project.activePattern,
  }));
  $('variation-list').replaceChildren(...variationCandidates.map((candidate, index) => {
    const card = document.createElement('div');
    card.className = 'variation-card';
    const hitCount = Object.values(candidate.sequences).reduce((total, sequence) => total + sequence.filter(step => step.active).length, 0);
    const title = document.createElement('strong');
    title.textContent = `Variation ${index + 1}`;
    const meta = document.createElement('span');
    meta.textContent = `${hitCount} events · seed ${controls.seed}`;
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'button secondary';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => applyVariation(index));
    card.append(title, meta, apply);
    return card;
  }));
  project.generator = {
    ...project.generator,
    genre: controls.genre,
    energy: controls.energy,
    seed: controls.seed,
    complexity: controls.complexity,
    syncopation: controls.syncopation,
    humanize: controls.humanize,
  };
  setAiStatus('Three editable local variations are ready. Choose one to apply.', 'Local composer');
}

function applyVariation(index) {
  const candidate = variationCandidates[index];
  if (!candidate) return;
  if (candidate.contextToken !== projectChangeToken || candidate.patternSlot !== project.activePattern) {
    clearVariationCandidates();
    showToast('The project changed. Create fresh variations before applying one.', { error: true });
    return;
  }
  mutateProject(draft => {
    draft.sequences = deepClone(candidate.sequences);
    draft.generator = {
      ...draft.generator,
      ...projectGeneratorControls(),
      variation: ['a', 'b', 'c'][index],
    };
  });
  setAiStatus(`Variation ${index + 1} applied. Every step remains editable.`, 'Local composer');
  showToast(`Variation ${index + 1} applied`);
}

function evolveCurrentPattern() {
  const controls = projectGeneratorControls();
  const random = createSeededRandom(`${controls.seed}:evolve:${Date.now() >> 12}`);
  const transform = random() > 0.66 ? 'dense' : random() > 0.33 ? 'rotate' : 'sparse';
  mutateProject(draft => {
    const transformed = applyPatternTransform(draft.sequences, transform, {
      amount: transform === 'rotate' ? (random() > 0.5 ? 1 : -1) : 0.12 + controls.complexity * 0.15,
      seed: `${controls.seed}:evolved`,
      locks: Object.fromEntries([...lockedLanes].map(id => [id, true])),
    });
    GENERATED_DRUM_TRACK_IDS.forEach(id => { if (!lockedLanes.has(id)) draft.sequences[id] = transformed[id]; });
    addTonalVariation(draft.sequences, { ...controls, seed: `${controls.seed}-evolved` }, 2);
  });
  setAiStatus(`Pattern evolved with ${transform} transformation.`, 'Local composer');
  showToast('Pattern evolved');
}

function transformCurrentLane(transformName) {
  const transformMap = {
    'rotate-left': ['rotate', -1],
    'rotate-right': ['rotate', 1],
  };
  const [transform, amount] = transformMap[transformName] || [transformName, undefined];
  mutateProject(draft => {
    if (GENERATED_DRUM_TRACK_IDS.includes(currentTrackId)) {
      const transformed = applyPatternTransform(draft.sequences, transform, {
        amount,
        seed: `${draft.generator.seed}:${currentTrackId}:${transform}`,
        trackIds: [currentTrackId],
      });
      draft.sequences[currentTrackId] = transformed[currentTrackId];
      return;
    }
    const sequence = draft.sequences[currentTrackId];
    if (transform === 'rotate') {
      const shift = amount ?? 1;
      draft.sequences[currentTrackId] = sequence.map((_, index) => sequence[(index - shift + sequence.length) % sequence.length]);
    } else if (transform === 'reverse' || transform === 'mirror') {
      draft.sequences[currentTrackId] = sequence.slice().reverse();
    } else if (transform === 'sparse') {
      draft.sequences[currentTrackId] = sequence.map((step, index) => index % 3 === 1 ? normalizeStep({}) : step);
    } else if (transform === 'dense' || transform === 'euclidean') {
      draft.sequences[currentTrackId] = sequence.map((step, index) => index % 4 === 0 ? normalizeStep({ ...step, active: true, probability: .9 }) : step);
    } else if (transform === 'fill') {
      for (let index = 28; index < 32; index += 1) draft.sequences[currentTrackId][index] = normalizeStep({ active: true, velocity: .72 + (index - 28) * .08, ratchet: index === 31 ? 2 : 1 });
    }
  });
  showToast(`${transformName.replace('-', ' ')} applied to ${TRACK_REGISTRY[currentTrackId].label}`);
}

function randomizeCurrentLane() {
  const random = createSeededRandom(`${project.generator.seed}:${currentTrackId}:${Date.now()}`);
  mutateProject(draft => {
    draft.sequences[currentTrackId] = draft.sequences[currentTrackId].map((step, index) => normalizeStep({
      ...step,
      active: index % 4 === 0 ? random() > 0.28 : random() < 0.24,
      velocity: 0.55 + random() * 0.45,
      probability: random() > 0.75 ? 0.7 + random() * 0.3 : 1,
      ratchet: random() > 0.9 ? 2 : 1,
      pitch: isPitchedTrack(currentTrackId) ? Math.floor(random() * 13) - 6 : 0,
    }));
  });
  showToast(`${TRACK_REGISTRY[currentTrackId].label} randomized`);
}

function clearCurrentLane() {
  mutateProject(draft => {
    draft.sequences[currentTrackId] = draft.sequences[currentTrackId].map(() => normalizeStep({}));
  });
  selectedStepIndex = null;
  renderStepEditor();
  showToast(`${TRACK_REGISTRY[currentTrackId].label} cleared`);
}

function toggleLaneLock() {
  if (lockedLanes.has(currentTrackId)) lockedLanes.delete(currentTrackId);
  else lockedLanes.add(currentTrackId);
  if (Object.hasOwn(project.locks, currentTrackId)) project.locks[currentTrackId] = lockedLanes.has(currentTrackId);
  $('lock-current-track').setAttribute('aria-pressed', String(lockedLanes.has(currentTrackId)));
  $('lock-current-track').textContent = lockedLanes.has(currentTrackId) ? 'Unlock current lane' : 'Lock current lane';
  queueAutosave();
}

function capturePerformance() {
  if (!captureEvents.length) {
    showToast('Play the computer keyboard or MIDI pads first');
    return;
  }
  const first = captureEvents[0].time;
  mutateProject(draft => {
    captureEvents.forEach(event => {
      const elapsed = (event.time - first) / 1000;
      const step = Math.round(elapsed / stepDurationSeconds()) % SEQUENCE_LENGTH;
      draft.sequences[event.trackId][step] = normalizeStep({ active: true, velocity: event.velocity, probability: 1 });
    });
  });
  captureEvents = [];
  showToast('Recent performance captured');
}

async function initializeStores() {
  let migrationWarning = false;
  try {
    projectStore = await openProjectStore({
      validateProject: normalizeUiProject,
      autosaveDelayMs: 650,
      migrateLegacy: false,
      onStorageError: error => console.warn('IndexedDB project storage unavailable; using a safe fallback.', error),
    });
    try {
      projectStore.migration = await projectStore.migrateLegacyPattern();
    } catch (error) {
      migrationWarning = true;
      console.warn('The old dm99-pattern save could not be migrated; new project storage is still available.', error);
    }
  } catch (error) {
    console.warn('Local project storage could not initialize:', error);
    $('autosave-status').textContent = 'Session-only mode';
  }

  try {
    samplerStore = await openSamplerStore({
      onError: error => console.warn('IndexedDB sample storage unavailable; using memory storage.', error),
    });
    if (!samplerStore.persistent) {
      $('sample-status').textContent = 'Sample storage is session-only in this browser. Export the project audio you need.';
    }
    await refreshSampleLibrary();
  } catch (error) {
    console.warn('Local sample storage could not initialize:', error);
    $('sample-status').textContent = 'Sample storage is unavailable; built-in voices still work.';
  }

  if (!projectStore) return;
  try {
    await refreshProjectList();

    const sharedProject = await loadSharedPattern();
    if (!sharedProject) {
      let restoredLastProject = false;
      const lastProjectId = readLastProject();
      if (lastProjectId) {
        const lastProject = await projectStore.getProject(lastProjectId);
        if (lastProject?.data) {
          currentProjectId = lastProject.id;
          restoreSnapshot(lastProject.data);
          $('autosave-status').textContent = `Restored ${lastProject.name}`;
          restoredLastProject = true;
        } else {
          rememberLastProject('');
        }
      }

      const autosave = restoredLastProject ? null : await projectStore.getProject(AUTOSAVE_ID);
      if (autosave?.data) {
        currentProjectId = autosave.id;
        restoreSnapshot(autosave.data);
        $('autosave-status').textContent = 'Autosave restored';
      } else if (!restoredLastProject && projectStore.migration?.status === 'migrated') {
        const migrated = await projectStore.getProject(projectStore.migration.projectId);
        if (migrated?.data) {
          currentProjectId = migrated.id;
          restoreSnapshot(migrated.data);
          $('autosave-status').textContent = 'Previous DM99 pattern migrated';
        }
      }
    }
    await refreshProjectList();
    if (!projectStore.persistent) $('autosave-status').textContent = 'Projects are session-only';
    else if (migrationWarning && $('autosave-status').textContent === 'Autosave ready') $('autosave-status').textContent = 'New project storage ready';
  } catch (error) {
    console.warn('Saved project restoration failed; the new workspace remains available.', error);
    $('autosave-status').textContent = projectStore.persistent ? 'Project storage ready' : 'Projects are session-only';
  }
}

async function refreshProjectList() {
  if (!projectStore) return;
  const projects = await projectStore.listProjects();
  const select = $('project-select');
  select.replaceChildren();
  if (!projects.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No saved projects';
    select.append(option);
    await refreshRevisionList('');
    return;
  }
  projects.forEach(record => {
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = `${record.name} · r${record.revision}`;
    option.selected = record.id === currentProjectId;
    select.append(option);
  });
  await refreshRevisionList(select.value);
}

async function refreshRevisionList(projectId = $('project-select').value) {
  const select = $('project-revision-select');
  const restoreButton = $('restore-revision');
  select.replaceChildren();
  select.disabled = true;
  restoreButton.disabled = true;

  if (!projectStore || !projectId) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Select a saved project';
    select.append(option);
    return;
  }

  try {
    const revisions = await projectStore.listRevisions(projectId, { limit: 50 });
    if (!revisions.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No revisions available';
      select.append(option);
      return;
    }
    revisions.forEach(record => {
      const option = document.createElement('option');
      option.value = String(record.revision);
      const date = new Date(record.createdAt);
      const timestamp = Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
      option.textContent = `Revision ${record.revision}${timestamp} · ${record.reason || 'saved'}`;
      select.append(option);
    });
    select.disabled = false;
    restoreButton.disabled = false;
  } catch (error) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Revision history unavailable';
    select.append(option);
    console.warn('Could not list project revisions:', error);
  }
}

async function saveProjectManually() {
  if (!projectStore) return showToast('Project storage is unavailable', { error: true });
  const name = $('project-name').value.trim() || 'Untitled groove';
  project.projectName = name;
  try {
    const promotingDraft = !currentProjectId || currentProjectId === AUTOSAVE_ID;
    if (promotingDraft) projectStore.cancelAutosave(AUTOSAVE_ID);
    const record = await projectStore.saveProject(snapshotProject(), {
      id: currentProjectId && currentProjectId !== AUTOSAVE_ID ? currentProjectId : undefined,
      name,
      reason: 'manual',
    });
    if (promotingDraft && record.id !== AUTOSAVE_ID) await projectStore.deleteProject(AUTOSAVE_ID);
    currentProjectId = record.id;
    rememberLastProject(record.id);
    $('autosave-status').textContent = `Saved revision ${record.revision}`;
    await refreshProjectList();
    showToast(`Saved “${record.name}”`);
  } catch (error) {
    showToast(error.message || 'Could not save project', { error: true });
  }
}

async function loadSelectedProject() {
  const id = $('project-select').value;
  if (!id || !projectStore) return;
  try {
    projectStore.cancelAutosave(id);
    const record = await projectStore.getProject(id);
    if (!record) throw new Error('Project no longer exists.');
    stopTransport();
    currentProjectId = record.id;
    rememberLastProject(record.id);
    historyStack = [];
    futureStack = [];
    restoreSnapshot(record.data, { restoreSamples: false });
    $('project-name').value = record.name;
    const samples = await restoreAssignedSamples();
    await refreshRevisionList(id);
    showToast(samples.missing ? `Loaded “${record.name}” with ${samples.missing} unavailable custom sample${samples.missing === 1 ? '' : 's'}; local voices are active` : `Loaded “${record.name}”`);
  } catch (error) {
    showToast(error.message || 'Could not load project', { error: true });
  }
}

async function restoreSelectedRevision() {
  const id = $('project-select').value;
  const revision = Number($('project-revision-select').value);
  if (!id || !Number.isInteger(revision) || !projectStore) return;
  try {
    projectStore.cancelAutosave(id);
    stopTransport();
    const record = await projectStore.restoreRevision(id, revision);
    currentProjectId = record.id;
    rememberLastProject(record.id);
    historyStack = [];
    futureStack = [];
    restoreSnapshot(record.data, { restoreSamples: false });
    $('project-name').value = record.name;
    const samples = await restoreAssignedSamples();
    await refreshProjectList();
    showToast(samples.missing
      ? `Revision ${revision} restored; ${samples.missing} custom sample${samples.missing === 1 ? '' : 's'} unavailable`
      : `Revision ${revision} restored as revision ${record.revision}`);
  } catch (error) {
    showToast(error.message || 'Could not restore revision', { error: true });
  }
}

async function deleteSelectedProject() {
  const id = $('project-select').value;
  if (!id || !projectStore) return;
  const label = $('project-select').selectedOptions[0]?.textContent || 'this project';
  if (!confirm(`Delete ${label}? Local revisions for it will also be removed.`)) return;
  try {
    await projectStore.deleteProject(id);
    if (currentProjectId === id) {
      currentProjectId = null;
      rememberLastProject('');
    }
    await refreshProjectList();
    showToast('Local project deleted');
  } catch (error) {
    showToast(error.message || 'Could not delete project', { error: true });
  }
}

async function exporterModule() {
  return import('./src/exporters.js');
}

async function exportJson() {
  try {
    const { createProjectJsonBlob } = await exporterModule();
    const blob = createProjectJsonBlob(snapshotProject(), { validateProject: normalizeUiProject });
    downloadBlob(blob, safeFilename(project.projectName, 'json'));
    showToast('Project JSON exported');
  } catch (error) {
    showToast(error.message || 'JSON export failed', { error: true });
  }
}

async function importJsonFile(file) {
  if (!file) return;
  try {
    const { importProjectJsonBlob } = await exporterModule();
    const imported = await importProjectJsonBlob(file, { validateProject: normalizeUiProject });
    stopTransport();
    historyStack.push(historySnapshot());
    project = normalizeUiProject(imported);
    coerceAudioSettings();
    projectChangeToken += 1;
    clearVariationCandidates();
    lockedLanes = new Set(Object.entries(project.locks || {}).filter(([, locked]) => locked).map(([id]) => id));
    currentProjectId = null;
    rememberLastProject('');
    futureStack = [];
    renderAll();
    audioEngine?.clearUserBuffers();
    applyProjectToAudio();
    const samples = await restoreAssignedSamples();
    queueAutosave();
    showToast(samples.missing ? `Project imported; ${samples.missing} local sample${samples.missing === 1 ? '' : 's'} were unavailable, so procedural voices are active` : 'Project imported safely');
  } catch (error) {
    showToast(error.message || 'Invalid project file', { error: true });
  } finally {
    $('import-json').value = '';
  }
}

async function exportMidiFile() {
  try {
    const { exportProjectMidi } = await exporterModule();
    const bytes = exportProjectMidi(snapshotProject(), { validateProject: normalizeUiProject });
    downloadBlob(new Blob([bytes], { type: 'audio/midi' }), safeFilename(project.projectName, 'mid'));
    showToast('MIDI exported');
  } catch (error) {
    showToast(error.message || 'MIDI export failed', { error: true });
  }
}

async function importMidiFile(file) {
  if (!file) return;
  try {
    const { importProjectMidi, MIDI_MAX_BYTES } = await exporterModule();
    if (file.size > MIDI_MAX_BYTES) throw new Error(`MIDI file exceeds the ${Math.round(MIDI_MAX_BYTES / 1024 / 1024)} MB import limit.`);
    const imported = importProjectMidi(await file.arrayBuffer(), { validateProject: normalizeUiProject });
    historyStack.push(historySnapshot());
    const activePattern = project.activePattern;
    project = normalizeUiProject({
      ...project,
      projectName: file.name.replace(/\.[^.]+$/u, ''),
      tempo: imported.tempo,
      sequences: imported.sequences,
      patterns: { ...project.patterns, [activePattern]: imported.sequences },
      generator: { ...project.generator, seed: imported.generator.seed },
    });
    projectChangeToken += 1;
    clearVariationCandidates();
    currentProjectId = null;
    rememberLastProject('');
    futureStack = [];
    renderAll();
    applyProjectToAudio();
    queueAutosave();
    showToast('MIDI imported into editable steps');
  } catch (error) {
    showToast(error.message || 'MIDI import failed', { error: true });
  } finally {
    $('import-midi').value = '';
  }
}

async function exportWavMixdown() {
  const button = $('export-wav');
  button.disabled = true;
  button.textContent = 'Rendering…';
  try {
    const { renderPatternOffline } = await import('./src/audio-engine.js');
    if (typeof renderPatternOffline !== 'function') throw new Error('Offline mixdown is unavailable in this browser build.');
    const engine = await ensureAudio();
    const trackSettings = Object.fromEntries(await Promise.all(TRACK_IDS.map(async trackId => {
      const setting = {
        ...project.trackSettings[trackId],
        gain: project.volumes[trackId],
        muted: project.muted[trackId],
        solo: project.soloed[trackId],
      };
      const sampleId = project.trackSettings[trackId]?.sample?.id;
      if (sampleId) {
        if (!samplerStore) throw new Error(`Custom sample storage is unavailable for ${TRACK_REGISTRY[trackId].label}.`);
        const blob = await samplerStore.getSampleBlob(sampleId);
        if (!blob) throw new Error(`Custom sample for ${TRACK_REGISTRY[trackId].label} is unavailable. Reassign it before rendering WAV.`);
        setting.audioBuffer = await engine.context.decodeAudioData(await blob.arrayBuffer());
        const sample = project.trackSettings[trackId].sample;
        setting.bufferOptions = {
          tune: sample.tune,
          rootMidi: 60,
          mode: sample.mode,
          offset: (sample.start || 0) * setting.audioBuffer.duration,
          duration: Math.max(0.005, ((sample.end ?? 1) - (sample.start || 0)) * setting.audioBuffer.duration),
        };
      }
      return [trackId, setting];
    })));
    const rendered = await renderPatternOffline(project.sequences, {
      tempo: project.tempo,
      swing: project.swing,
      kitId: project.kitId,
      trackSettings,
      masterSettings: {
        gain: project.effects.masterVolume,
        eq: project.effects.masterEq,
        filter: { highpass: project.effects.highpassHz, lowpass: project.effects.lowpassHz },
        compressor: {
          threshold: -24 - project.effects.drive * 18,
          ratio: 6 + project.effects.drive * 10,
        },
      },
      effects: {
        delay: { wet: project.effects.delayWet },
        reverb: { wet: project.effects.reverbWet },
      },
      tailSeconds: 5,
      random: createSeededRandom(`${project.generator.seed}:${project.activePattern}:playback`),
    });
    const { createWavBlob } = await exporterModule();
    downloadBlob(createWavBlob(rendered), safeFilename(project.projectName, 'wav'));
    showToast('WAV mixdown rendered locally');
  } catch (error) {
    showToast(error.message || 'WAV render failed', { error: true });
  } finally {
    button.disabled = false;
    button.textContent = 'WAV mixdown';
  }
}

async function sharePattern() {
  try {
    const { createPatternShareFragment } = await exporterModule();
    const shareable = snapshotProject();
    shareable.projectName = 'Shared DM99 pattern';
    for (const trackId of TRACK_IDS) {
      shareable.trackSettings[trackId].sample = {
        id: '', name: '', url: '', source: 'procedural', mimeType: '', license: '',
        attribution: '', start: 0, end: 1, tune: 0, mode: 'one-shot',
      };
    }
    const fragment = await createPatternShareFragment(shareable, { validateProject: normalizeUiProject });
    const url = `${location.origin}${location.pathname}${fragment}`;
    history.replaceState(null, '', fragment);
    const copied = await copyText(url);
    showToast(copied ? 'Pattern link copied — no audio was included' : 'Pattern link is ready in the address bar');
  } catch (error) {
    showToast(error.message || 'Pattern is too large for a URL', { error: true });
  }
}

async function loadSharedPattern() {
  if (!location.hash.startsWith('#dm99=')) return false;
  try {
    const { parsePatternShareFragment } = await exporterModule();
    const shared = await parsePatternShareFragment(location.hash, { validateProject: normalizeUiProject });
    restoreSnapshot(shared);
    currentProjectId = null;
    rememberLastProject('');
    queueAutosave();
    showToast('Shared pattern opened locally');
    return true;
  } catch (error) {
    console.warn('Invalid DM99 share fragment:', error);
    showToast('This shared pattern could not be opened', { error: true });
    return false;
  }
}

async function restoreAssignedSamples() {
  const restoreToken = ++sampleRestoreToken;
  const restoreEngine = audioEngine;
  const restoreStore = samplerStore;
  const assignments = TRACK_IDS.map(trackId => ({
    trackId,
    sample: deepClone(project.trackSettings[trackId]?.sample || {}),
    chokeGroup: project.trackSettings[trackId]?.chokeGroup,
  }));
  if (!restoreEngine || restoreEngine.status !== 'ready') {
    let missing = 0;
    for (const { sample } of assignments) {
      if (!sample?.id) continue;
      try {
        const blob = await restoreStore?.getSampleBlob(sample.id);
        if (restoreToken !== sampleRestoreToken) return { restored: 0, missing, cancelled: true };
        if (!blob) missing += 1;
      } catch (error) {
        missing += 1;
        console.warn('Could not verify a local sample assignment:', error);
      }
    }
    return { restored: 0, missing };
  }
  const isCurrent = () => restoreToken === sampleRestoreToken
    && restoreEngine === audioEngine
    && restoreEngine.status === 'ready';
  restoreEngine.clearUserBuffers();
  let restored = 0;
  let missing = 0;
  for (const { trackId, sample, chokeGroup } of assignments) {
    if (!sample?.id) continue;
    try {
      const blob = await restoreStore?.getSampleBlob(sample.id);
      if (!isCurrent()) return { restored, missing, cancelled: true };
      if (!blob) {
        missing += 1;
        continue;
      }
      const bytes = await blob.arrayBuffer();
      if (!isCurrent()) return { restored, missing, cancelled: true };
      const buffer = await restoreEngine.context.decodeAudioData(bytes);
      if (!isCurrent()) return { restored, missing, cancelled: true };
      restoreEngine.setUserBuffer(trackId, buffer, {
        tune: sample.tune,
        rootMidi: 60,
        mode: sample.mode,
        offset: (sample.start || 0) * buffer.duration,
        duration: Math.max(0.005, ((sample.end ?? 1) - (sample.start || 0)) * buffer.duration),
        chokeGroup,
      });
      restoreEngine.setTrackChokeGroup?.(trackId, chokeGroup);
      restored += 1;
    } catch (error) {
      missing += 1;
      console.warn(`Could not restore local sample for ${trackId}:`, error);
    }
  }
  if (isCurrent()) renderTrackIdentity();
  return { restored, missing };
}

function drawWaveform(buffer = activeSampleBuffer) {
  const canvas = $('sample-waveform');
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0b0d12';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#c9ff39';
  context.lineWidth = 2;
  context.beginPath();
  if (!buffer) {
    context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
    return;
  }
  const channel = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(channel.length / width));
  for (let x = 0; x < width; x += 1) {
    let min = 1; let max = -1;
    const start = x * block;
    for (let index = start; index < Math.min(channel.length, start + block); index += 1) {
      min = Math.min(min, channel[index]); max = Math.max(max, channel[index]);
    }
    const top = (1 - max) * height / 2;
    const bottom = (1 - min) * height / 2;
    context.moveTo(x, top); context.lineTo(x, bottom);
  }
  context.stroke();
  const startRatio = Number($('sample-start').value) / 100;
  const endRatio = Number($('sample-end').value) / 100;
  context.fillStyle = 'rgba(255,93,74,.18)';
  context.fillRect(0, 0, startRatio * width, height);
  context.fillRect(endRatio * width, 0, width - endRatio * width, height);
}

async function refreshSampleLibrary(selectedId = $('sample-library-select')?.value || '') {
  const select = $('sample-library-select');
  const loadButton = $('load-library-sample');
  const deleteButton = $('delete-library-sample');
  select.replaceChildren();
  select.disabled = true;
  loadButton.disabled = true;
  deleteButton.disabled = true;

  if (!samplerStore) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Sample storage unavailable';
    select.append(option);
    $('sample-library-usage').textContent = 'Built-in local voices remain available';
    return;
  }

  try {
    const samples = await samplerStore.listSamples();
    const usedBytes = samples.reduce((total, sample) => total + (Number(sample.size) || 0), 0);
    $('sample-library-usage').textContent = samples.length
      ? `${samples.length} sample${samples.length === 1 ? '' : 's'} · ${formatStorageSize(usedBytes)} used locally`
      : 'No saved samples';
    if (!samples.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No saved samples';
      select.append(option);
      return;
    }
    samples.forEach(record => {
      const option = document.createElement('option');
      option.value = record.id;
      option.textContent = `${record.name} · ${formatStorageSize(record.size)}`;
      option.selected = record.id === selectedId;
      select.append(option);
    });
    select.disabled = false;
    loadButton.disabled = false;
    deleteButton.disabled = false;
  } catch (error) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Could not read saved samples';
    select.append(option);
    console.warn('Could not refresh sample library:', error);
  }
}

async function loadLibrarySample() {
  const id = $('sample-library-select').value;
  if (!id || !samplerStore) return;
  try {
    const record = await samplerStore.getSample(id);
    if (!record?.blob) throw new Error('This sample is no longer available.');
    const file = new File([record.blob], record.name, { type: record.mimeType || record.blob.type || 'audio/wav' });
    const loaded = await loadSampleFile(file);
    if (!loaded) return;
    $('sample-status').textContent = `${record.name} loaded from the on-device library · edit it or assign it to a track`;
  } catch (error) {
    showToast(error.message || 'Saved sample could not be loaded', { error: true });
  }
}

async function deleteLibrarySample() {
  const id = $('sample-library-select').value;
  if (!id || !samplerStore) return;
  const name = $('sample-library-select').selectedOptions[0]?.textContent || 'this sample';
  const referencedTracks = TRACK_IDS.filter(trackId => project.trackSettings[trackId]?.sample?.id === id);
  const warning = referencedTracks.length
    ? ` It is assigned to ${referencedTracks.length} lane${referencedTracks.length === 1 ? '' : 's'} in the current project, which will return to local voices.`
    : ' Saved projects or revisions that reference it will use local voices instead.';
  if (!confirm(`Delete ${name}?${warning}`)) return;
  try {
    await samplerStore.deleteSample(id);
    if (referencedTracks.length) {
      mutateProject(draft => {
        referencedTracks.forEach(trackId => {
          draft.trackSettings[trackId].sample = createProceduralSampleMetadata();
        });
      }, { render: false });
      referencedTracks.forEach(trackId => audioEngine?.clearUserBuffer(trackId));
      renderAll();
    }
    await refreshSampleLibrary();
    showToast('Local sample deleted');
  } catch (error) {
    showToast(error.message || 'Sample could not be deleted', { error: true });
  }
}

async function loadSampleFile(file) {
  if (!file) return false;
  try {
    const engine = await ensureAudio();
    if (file.size > 25 * 1024 * 1024) throw new Error('Sample exceeds the 25 MB local limit.');
    activeSampleBuffer = await engine.context.decodeAudioData(await file.arrayBuffer());
    activeSampleFile = file;
    $('sample-editor').classList.remove('hidden');
    $('sample-start').value = '0';
    $('sample-end').value = '100';
    drawWaveform();
    $('sample-status').textContent = `${file.name} · ${activeSampleBuffer.duration.toFixed(2)} seconds · ${activeSampleBuffer.numberOfChannels} channel${activeSampleBuffer.numberOfChannels === 1 ? '' : 's'}`;
    return true;
  } catch (error) {
    activeSampleBuffer = null;
    showToast(error.message || 'Audio file could not be decoded', { error: true });
    return false;
  } finally {
    $('sample-import').value = '';
  }
}

function copyAudioBuffer(buffer, { start = 0, end = 1, normalize = false, reverse = false } = {}) {
  if (!audioEngine?.context) throw new Error('Audio must be enabled first.');
  const startFrame = Math.floor(clamp(start, 0, 0.999) * buffer.length);
  const endFrame = Math.max(startFrame + 1, Math.ceil(clamp(end, 0.001, 1) * buffer.length));
  const length = Math.min(buffer.length, endFrame) - startFrame;
  const output = audioEngine.context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  let peak = 0;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const source = buffer.getChannelData(channelIndex).subarray(startFrame, startFrame + length);
    const target = output.getChannelData(channelIndex);
    target.set(source);
    for (const value of target) peak = Math.max(peak, Math.abs(value));
  }
  const gain = normalize && peak > 0 ? Math.min(8, 0.96 / peak) : 1;
  for (let channelIndex = 0; channelIndex < output.numberOfChannels; channelIndex += 1) {
    const target = output.getChannelData(channelIndex);
    if (gain !== 1) for (let index = 0; index < target.length; index += 1) target[index] *= gain;
    if (reverse) target.reverse();
  }
  return output;
}

function normalizeActiveSample() {
  if (!activeSampleBuffer) return;
  activeSampleBuffer = copyAudioBuffer(activeSampleBuffer, { normalize: true });
  drawWaveform();
  showToast('Sample normalized locally');
}

function reverseActiveSample() {
  if (!activeSampleBuffer) return;
  activeSampleBuffer = copyAudioBuffer(activeSampleBuffer, { reverse: true });
  drawWaveform();
  showToast('Sample reversed locally');
}

async function persistBufferForTrack(trackId, buffer, name) {
  if (!samplerStore) throw new Error('Local sample storage is unavailable.');
  const { createWavBlob } = await exporterModule();
  const blob = createWavBlob(buffer);
  const record = await samplerStore.putSample(blob, {
    name,
    metadata: { trackId, provenance: 'user-provided', createdBy: 'DM99 local sampler' },
  });
  sampleRestoreToken += 1;
  const chokeGroup = $('sample-choke').value;
  audioEngine.setUserBuffer(trackId, buffer, {
    mode: $('sample-mode').value,
    tune: Number($('sample-tune').value),
    rootMidi: 60,
    chokeGroup,
  });
  mutateProject(draft => {
    draft.trackSettings[trackId].sample = {
      ...draft.trackSettings[trackId].sample,
      id: record.id,
      name,
      source: 'custom',
      mimeType: 'audio/wav',
      license: 'user-provided',
      start: 0,
      end: 1,
      tune: Number($('sample-tune').value),
      mode: $('sample-mode').value,
    };
    draft.trackSettings[trackId].chokeGroup = chokeGroup;
  }, { render: false });
  audioEngine.setTrackChokeGroup?.(trackId, chokeGroup);
  await refreshSampleLibrary(record.id);
  return record;
}

async function commitActiveSample() {
  if (!activeSampleBuffer) return;
  try {
    const start = Number($('sample-start').value) / 100;
    const end = Number($('sample-end').value) / 100;
    if (end <= start) throw new Error('Sample end must be after its start.');
    const cropped = copyAudioBuffer(activeSampleBuffer, { start, end });
    const trackId = $('sample-track-select').value;
    await persistBufferForTrack(trackId, cropped, activeSampleFile?.name || `DM99 ${TRACK_REGISTRY[trackId].label} sample`);
    activeSampleBuffer = cropped;
    drawWaveform();
    renderAll();
    showToast(`Local sample assigned to ${TRACK_REGISTRY[trackId].label}`);
  } catch (error) {
    showToast(error.message || 'Sample could not be stored', { error: true });
  }
}

async function sliceSampleToFourTracks() {
  if (!activeSampleBuffer) return;
  try {
    await ensureAudio();
    const startTrack = $('sample-track-select').value;
    const eligible = TRACK_IDS.filter(id => !TONAL_TRACK_IDS.includes(id));
    const startIndex = Math.max(0, eligible.indexOf(startTrack));
    for (let slice = 0; slice < 4; slice += 1) {
      const trackId = eligible[(startIndex + slice) % eligible.length];
      const buffer = copyAudioBuffer(activeSampleBuffer, { start: slice / 4, end: (slice + 1) / 4 });
      await persistBufferForTrack(trackId, buffer, `${activeSampleFile?.name || 'DM99 sample'} slice ${slice + 1}`);
    }
    renderAll();
    showToast('Four slices assigned to consecutive percussion lanes');
  } catch (error) {
    showToast(error.message || 'Sample slicing failed', { error: true });
  }
}

async function startMicrophoneRecording() {
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder !== 'function') throw new Error('Microphone recording is not supported in this browser.');
    await ensureAudio();
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    mediaRecorder = new MediaRecorder(recordingStream);
    mediaRecorder.addEventListener('dataavailable', event => { if (event.data.size) recordingChunks.push(event.data); });
    mediaRecorder.addEventListener('stop', async () => {
      try {
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const file = new File([blob], `DM99 recording ${new Date().toISOString().replace(/[:.]/g, '-')}.webm`, { type: blob.type });
        await loadSampleFile(file);
      } finally {
        recordingStream?.getTracks().forEach(track => track.stop());
        recordingStream = null;
        mediaRecorder = null;
        $('record-sample').disabled = false;
        $('stop-recording').disabled = true;
      }
    }, { once: true });
    mediaRecorder.start(250);
    $('record-sample').disabled = true;
    $('stop-recording').disabled = false;
    $('sample-status').textContent = 'Recording locally…';
  } catch (error) {
    recordingStream?.getTracks().forEach(track => track.stop());
    showToast(error.name === 'NotAllowedError' ? 'Microphone permission was not granted' : error.message, { error: true });
  }
}

function stopMicrophoneRecording() {
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
}

function coerceAudioSettings() {
  if (!KIT_SNAPSHOTS[project.kitId]) project.kitId = DEFAULT_KIT_ID;
  const kit = KIT_SNAPSHOTS[project.kitId];
  TRACK_IDS.forEach(trackId => {
    project.trackSettings[trackId] ||= {};
    const preset = AUDIO_PRESET_REGISTRY[project.trackSettings[trackId].presetId];
    if (!preset || preset.trackId !== trackId) project.trackSettings[trackId].presetId = kit.presets[trackId];
    project.trackSettings[trackId].pan = clamp(project.trackSettings[trackId].pan ?? 0, -1, 1);
    project.trackSettings[trackId].sample ||= {};
  });
  project.effects = {
    masterVolume: 0.82,
    lowpassHz: 20000,
    highpassHz: 20,
    masterEq: { low: 0, mid: 0, high: 0 },
    drive: 0,
    delayWet: 0.12,
    reverbWet: 0.08,
    ...(project.effects || {}),
  };
  project.effects.masterEq = {
    low: 0,
    mid: 0,
    high: 0,
    ...(project.effects.masterEq || {}),
  };
  project.generator = {
    genre: 'techno', energy: 0.7, complexity: 0.55, syncopation: 0.35,
    humanize: 0.12, seed: 'dm99', variation: 'a',
    ...(project.generator || {}),
  };
}

async function enableMidi() {
  if (!navigator.requestMIDIAccess) {
    $('midi-status').textContent = 'Web MIDI is not supported by this browser.';
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.addEventListener('statechange', refreshMidiInputs);
    refreshMidiInputs();
    $('midi-status').textContent = 'MIDI access enabled. Play notes to audition and capture tracks.';
  } catch (error) {
    $('midi-status').textContent = error.name === 'SecurityError' ? 'MIDI requires a secure browser context.' : 'MIDI permission was not granted.';
  }
}

function refreshMidiInputs() {
  const select = $('midi-input');
  select.replaceChildren();
  const inputs = [...(midiAccess?.inputs?.values() || [])];
  if (!inputs.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No MIDI input';
    select.append(option);
    return;
  }
  inputs.forEach(input => {
    const option = document.createElement('option');
    option.value = input.id;
    option.textContent = input.name || input.manufacturer || 'MIDI input';
    select.append(option);
    input.onmidimessage = null;
  });
  selectMidiInput(select.value || inputs[0].id);
}

function selectMidiInput(id) {
  if (!midiAccess) return;
  for (const input of midiAccess.inputs.values()) input.onmidimessage = input.id === id ? handleMidiMessage : null;
  $('midi-input').value = id;
}

function handleMidiMessage(event) {
  const [status, note, velocity = 0] = event.data;
  if ((status & 0xf0) !== 0x90 || velocity === 0) return;
  const trackId = GM_NOTE_TO_TRACK[note] || TRACK_IDS[note % TRACK_IDS.length];
  const normalizedVelocity = velocity / 127;
  previewTrack(trackId, { active: true, velocity: normalizedVelocity, probability: 1 });
  captureEvents.push({ trackId, velocity: normalizedVelocity, time: performance.now() });
  if (captureEvents.length > 256) captureEvents.shift();
}

function selectStudioTab(tabId) {
  const tabIds = ['projects', 'export', 'sampler', 'midi'];
  tabIds.forEach(id => {
    const selected = id === tabId;
    $(`${id}-tab`).setAttribute('aria-selected', String(selected));
    $(`${id}-panel`).classList.toggle('hidden', !selected);
    $(`${id}-tab`).tabIndex = selected ? 0 : -1;
  });
}

function handleStudioTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabIds = ['projects', 'export', 'sampler', 'midi'];
  const current = tabIds.indexOf(event.currentTarget.id.replace(/-tab$/u, ''));
  if (current < 0) return;
  event.preventDefault();
  const target = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabIds.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabIds.length) % tabIds.length;
  selectStudioTab(tabIds[target]);
  $(`${tabIds[target]}-tab`).focus();
}

function bindStepEditors() {
  const bindings = [
    ['step-velocity', 'velocity', value => Number(value)],
    ['step-probability', 'probability', value => Number(value)],
    ['step-ratchet', 'ratchet', value => Number(value)],
    ['step-nudge', 'nudgeMs', value => Number(value)],
    ['step-pitch', 'pitch', value => Number(value)],
    ['step-scale', 'scale', value => value],
    ['step-accent', 'accent', (_value, element) => element.checked],
    ['step-slide', 'slide', (_value, element) => element.checked],
  ];
  bindings.forEach(([id, field, parse]) => {
    const element = $(id);
    element.addEventListener('change', () => {
      if (!Number.isInteger(selectedStepIndex)) return;
      mutateProject(draft => {
        const step = draft.sequences[currentTrackId][selectedStepIndex];
        step[field] = parse(element.value, element);
        draft.sequences[currentTrackId][selectedStepIndex] = normalizeStep(step);
      });
      previewTrack(currentTrackId, project.sequences[currentTrackId][selectedStepIndex]);
    });
  });
}

function bindMasterControls() {
  $('master-volume').addEventListener('input', event => {
    project.effects.masterVolume = Number(event.target.value);
    audioEngine?.setMasterGain(project.effects.masterVolume);
    queueAutosave();
  });
  $('lowpass-filter').addEventListener('input', event => {
    project.effects.lowpassHz = Number(event.target.value);
    $('lowpass-output').textContent = project.effects.lowpassHz >= 10000 ? `${Math.round(project.effects.lowpassHz / 1000)} kHz` : `${project.effects.lowpassHz} Hz`;
    audioEngine?.setMasterFilter({ lowpass: project.effects.lowpassHz });
    queueAutosave();
  });
  $('highpass-filter').addEventListener('input', event => {
    project.effects.highpassHz = Number(event.target.value);
    $('highpass-output').textContent = `${project.effects.highpassHz} Hz`;
    audioEngine?.setMasterFilter({ highpass: project.effects.highpassHz });
    queueAutosave();
  });
  [
    ['master-eq-low', 'low', 'eq-low-output'],
    ['master-eq-mid', 'mid', 'eq-mid-output'],
    ['master-eq-high', 'high', 'eq-high-output'],
  ].forEach(([inputId, band, outputId]) => {
    $(inputId).addEventListener('input', event => {
      const value = Number(event.target.value);
      project.effects.masterEq[band] = value;
      $(outputId).textContent = `${value.toFixed(1).replace('.0', '')} dB`;
      audioEngine?.setMasterEQ(project.effects.masterEq);
      queueAutosave();
    });
  });
  $('master-drive').addEventListener('input', event => {
    project.effects.drive = Number(event.target.value);
    $('drive-output').textContent = `${Math.round(project.effects.drive * 100)}%`;
    audioEngine?.setCompressor({ threshold: -24 - project.effects.drive * 18, ratio: 6 + project.effects.drive * 10 });
    queueAutosave();
  });
  $('master-delay').addEventListener('input', event => {
    project.effects.delayWet = Number(event.target.value);
    $('delay-output').textContent = `${Math.round(project.effects.delayWet * 100)}%`;
    audioEngine?.setDelay({ wet: project.effects.delayWet });
    queueAutosave();
  });
  $('master-reverb').addEventListener('input', event => {
    project.effects.reverbWet = Number(event.target.value);
    $('reverb-output').textContent = `${Math.round(project.effects.reverbWet * 100)}%`;
    audioEngine?.setReverb({ wet: project.effects.reverbWet });
    queueAutosave();
  });
}

function bindControls() {
  $('enable-audio').addEventListener('click', () => { void ensureAudio().catch(() => {}); });
  $('audition-track').addEventListener('click', () => previewTrack());
  $('play').addEventListener('click', startTransport);
  $('stop').addEventListener('click', stopTransport);
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('random-pattern').addEventListener('click', randomizeCurrentLane);
  $('clear-pattern').addEventListener('click', clearCurrentLane);
  $('capture-performance').addEventListener('click', capturePerformance);
  $('step-page-1').addEventListener('click', () => { visibleStepPage = 0; renderSequencer(); });
  $('step-page-2').addEventListener('click', () => { visibleStepPage = 1; renderSequencer(); });

  $('kit-select').addEventListener('change', event => applyKit(event.target.value));
  $('preset-select').addEventListener('change', event => setTrackPreset(currentTrackId, event.target.value, true));
  $('tempo').addEventListener('input', event => {
    project.tempo = Number(event.target.value);
    $('bpm-display').textContent = event.target.value;
    queueAutosave();
  });
  $('swing').addEventListener('input', event => {
    project.swing = Number(event.target.value);
    $('swing-display').textContent = `${event.target.value}%`;
    queueAutosave();
  });
  $('project-name').addEventListener('change', event => { project.projectName = event.target.value.trim() || 'Untitled groove'; queueAutosave(); });

  $('generate-variations').addEventListener('click', generateVariations);
  $('evolve-variation').addEventListener('click', evolveCurrentPattern);
  $('lock-current-track').addEventListener('click', toggleLaneLock);
  document.querySelectorAll('[data-transform]').forEach(button => button.addEventListener('click', () => transformCurrentLane(button.dataset.transform)));

  $('open-mixer').addEventListener('click', () => $('mixer-dialog').showModal());
  $('close-mixer').addEventListener('click', () => $('mixer-dialog').close());
  $('guide-open').addEventListener('click', () => $('guide-dialog').showModal());
  $('guide-close').addEventListener('click', () => $('guide-dialog').close());
  [$('mixer-dialog'), $('guide-dialog')].forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  }));

  ['projects', 'export', 'sampler', 'midi'].forEach(id => {
    $(`${id}-tab`).addEventListener('click', () => selectStudioTab(id));
    $(`${id}-tab`).addEventListener('keydown', handleStudioTabKeydown);
  });
  $('save-project').addEventListener('click', saveProjectManually);
  $('project-select').addEventListener('change', event => { void refreshRevisionList(event.target.value); });
  $('load-project').addEventListener('click', loadSelectedProject);
  $('restore-revision').addEventListener('click', restoreSelectedRevision);
  $('delete-project').addEventListener('click', deleteSelectedProject);
  $('export-json').addEventListener('click', exportJson);
  $('import-json').addEventListener('change', event => importJsonFile(event.target.files[0]));
  $('export-midi').addEventListener('click', exportMidiFile);
  $('import-midi').addEventListener('change', event => importMidiFile(event.target.files[0]));
  $('export-wav').addEventListener('click', exportWavMixdown);
  $('share-pattern').addEventListener('click', sharePattern);

  $('sample-import').addEventListener('change', event => loadSampleFile(event.target.files[0]));
  $('sample-library-select').addEventListener('change', event => {
    const available = Boolean(event.target.value);
    $('load-library-sample').disabled = !available;
    $('delete-library-sample').disabled = !available;
  });
  $('load-library-sample').addEventListener('click', loadLibrarySample);
  $('delete-library-sample').addEventListener('click', deleteLibrarySample);
  $('record-sample').addEventListener('click', startMicrophoneRecording);
  $('stop-recording').addEventListener('click', stopMicrophoneRecording);
  $('normalize-sample').addEventListener('click', normalizeActiveSample);
  $('reverse-sample').addEventListener('click', reverseActiveSample);
  $('slice-sample').addEventListener('click', sliceSampleToFourTracks);
  $('commit-sample').addEventListener('click', commitActiveSample);
  ['sample-start', 'sample-end'].forEach(id => $(id).addEventListener('input', () => {
    $('sample-start-output').textContent = `${$('sample-start').value}%`;
    $('sample-end-output').textContent = `${$('sample-end').value}%`;
    drawWaveform();
  }));
  $('sample-tune').addEventListener('input', event => { $('sample-tune-output').textContent = `${event.target.value} st`; });

  $('enable-midi').addEventListener('click', enableMidi);
  $('midi-input').addEventListener('change', event => selectMidiInput(event.target.value));
  bindStepEditors();
  bindMasterControls();
}

function bindKeyboard() {
  document.addEventListener('keydown', event => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    const interactive = target instanceof Element && target.closest('button, a, [role="tab"], [contenteditable="true"]');
    if (editing || interactive || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (transportRunning) stopTransport(); else startTransport();
      return;
    }
    if (/^Digit[1-8]$/u.test(event.code)) {
      selectPatternSlot(PATTERN_SLOT_IDS[Number(event.code.at(-1)) - 1]);
      return;
    }
    const trackId = PERFORMANCE_KEYS[event.code];
    if (!trackId || event.repeat) return;
    event.preventDefault();
    const velocity = event.shiftKey ? 1 : 0.82;
    previewTrack(trackId, { active: true, velocity, probability: 1 });
    captureEvents.push({ trackId, velocity, time: performance.now() });
    if (captureEvents.length > 256) captureEvents.shift();
  });
}

function populateStaticOptions() {
  $('kit-select').replaceChildren(...Object.values(KIT_SNAPSHOTS).map(kit => {
    const option = document.createElement('option');
    option.value = kit.id;
    option.textContent = kit.name;
    return option;
  }));
  $('sample-track-select').replaceChildren(...TRACK_IDS.map(trackId => {
    const option = document.createElement('option');
    option.value = trackId;
    option.textContent = `${TRACK_REGISTRY[trackId].label} · ${TRACK_REGISTRY[trackId].group}`;
    return option;
  }));
  $('step-scale').replaceChildren(...SCALE_IDS.map(scale => {
    const option = document.createElement('option');
    option.value = scale;
    option.textContent = scale[0].toUpperCase() + scale.slice(1);
    return option;
  }));
}

function setupPwaInstall() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    $('install-app').classList.remove('hidden');
  });
  $('install-app').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    $('install-app').classList.add('hidden');
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(error => {
      console.warn('Offline cache registration failed:', error);
    }));
  }
}

function setupOutputs() {
  setRangeOutput('energy-slider', 'energy-output', value => `${Math.round(value * 100)}%`);
  setRangeOutput('complexity-slider', 'complexity-output', value => `${Math.round(value * 100)}%`);
  setRangeOutput('syncopation-slider', 'syncopation-output', value => `${Math.round(value * 100)}%`);
  setRangeOutput('humanize-slider', 'humanize-output', value => `${Math.round(value * 100)}%`);
}

async function initializeApp() {
  coerceAudioSettings();
  populateStaticOptions();
  setupOutputs();
  bindControls();
  bindKeyboard();
  setupPwaInstall();
  selectStudioTab('projects');
  renderAll();
  drawWaveform(null);
  $('loader-progress').style.width = '55%';
  $('loader-text').textContent = 'Restoring local projects…';
  await initializeStores();
  coerceAudioSettings();
  renderAll();
  $('loader-progress').style.width = '100%';
  $('loader-text').textContent = 'Local instrument ready';
  $('app').classList.remove('hidden');
  $('loading-screen').classList.add('fade-out');
  setTimeout(() => $('loading-screen').classList.add('hidden'), 240);
  setStatus('Tap Enable Audio');
}

window.addEventListener('beforeunload', () => {
  stopTransport();
  recordingStream?.getTracks().forEach(track => track.stop());
  void projectStore?.flushAutosaves().catch(() => {});
});

window.addEventListener('pagehide', () => { void projectStore?.flushAutosaves().catch(() => {}); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void projectStore?.flushAutosaves().catch(() => {});
});

initializeApp().catch(error => {
  console.error('DM99 initialization failed:', error);
  $('loader-text').textContent = 'DM99 could not initialize';
  $('app').classList.remove('hidden');
  $('loading-screen').classList.add('hidden');
  showToast(error.message || 'Application initialization failed', { error: true });
});

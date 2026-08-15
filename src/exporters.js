import {
    asciiBytes,
    base64UrlDecode,
    base64UrlEncode,
    concatBytes,
    decodeUtf8,
    encodeUtf8,
    encodeVariableLengthQuantity,
    readAscii,
    readUint16BigEndian,
    readUint32BigEndian,
    readVariableLengthQuantity,
    toUint8Array,
    uint16BigEndian,
    uint32BigEndian,
} from './binary-utils.js';
import {
    PROJECT_STEP_COUNT,
    ProjectValidationError,
    cloneJsonValue,
    normalizeProjectDocument,
} from './project-store.js';
import { PROJECT_STATE_VERSION } from './pattern-constants.js';

export const MIDI_PPQ = 480;
export const MIDI_MAX_BYTES = 2 * 1024 * 1024;
export const PROJECT_JSON_MAX_BYTES = 5_000_000;
export const SHARE_FRAGMENT_MAX_CHARS = 16_000;

export const GM_DRUM_NOTES = Object.freeze({
    kick: 36,
    snare: 38,
    clap: 39,
    tom: 45,
    rimshot: 37,
    cowbell: 56,
    hihatClosed: 42,
    hihatOpened: 46,
    crash: 49,
    ride: 51,
    perc1: 75,
    perc2: 76,
    perc3: 77,
    perc4: 60,
    perc5: 61,
    perc6: 62,
    shaker: 70,
    tamb: 54,
});

export const TONAL_BASE_NOTES = Object.freeze({
    bass1: 40,
    acid: 40,
    synth: 52,
    sub: 28,
    tr808: 36,
    fmBass: 40,
    pluck: 60,
    amPad: 52,
});

const TONAL_PROGRAMS = Object.freeze({ bass1: 38, acid: 39, synth: 81, sub: 39, tr808: 38, fmBass: 38, pluck: 25, amPad: 89 });
const ALL_TRACK_IDS = Object.freeze([...Object.keys(GM_DRUM_NOTES), ...Object.keys(TONAL_BASE_NOTES)]);
const TONAL_TRACK_IDS = Object.freeze(Object.keys(TONAL_BASE_NOTES));
const DRUM_NOTE_TO_TRACK = new Map(Object.entries(GM_DRUM_NOTES).map(([id, note]) => [note, id]));
const TRACK_ID_CASE_MAP = new Map(ALL_TRACK_IDS.map((id) => [id.toLowerCase(), id]));

export class ExportFormatError extends Error {
    constructor(message, { code = 'INVALID_EXPORT_FORMAT', cause } = {}) {
        super(message, { cause });
        this.name = 'ExportFormatError';
        this.code = code;
    }
}

function validatedProject(project, validateProject = normalizeProjectDocument) {
    if (typeof validateProject !== 'function') throw new TypeError('validateProject must be a function.');
    const candidate = cloneJsonValue(project);
    let result;
    try {
        result = validateProject(candidate);
    } catch (error) {
        if (error instanceof ExportFormatError || error instanceof ProjectValidationError) throw error;
        throw new ExportFormatError('Project validation failed.', { cause: error });
    }
    if (result && typeof result.then === 'function') throw new TypeError('Export validation hooks must be synchronous.');
    if (result === false) throw new ExportFormatError('Project validation rejected the document.');
    if (result === true || result === undefined) return candidate;
    return cloneJsonValue(result);
}

export function exportProjectJson(project, { space = 2, validateProject = normalizeProjectDocument } = {}) {
    if (!Number.isInteger(space) || space < 0 || space > 10) throw new RangeError('JSON indentation must be between 0 and 10.');
    return JSON.stringify(validatedProject(project, validateProject), null, space);
}

export function importProjectJson(input, {
    maxBytes = PROJECT_JSON_MAX_BYTES,
    validateProject = normalizeProjectDocument,
} = {}) {
    let text;
    if (typeof input === 'string') {
        if (encodeUtf8(input).byteLength > maxBytes) throw new ExportFormatError('Project JSON exceeds the size limit.', { code: 'PROJECT_TOO_LARGE' });
        text = input;
    } else {
        const bytes = toUint8Array(input, 'project JSON');
        if (bytes.byteLength > maxBytes) throw new ExportFormatError('Project JSON exceeds the size limit.', { code: 'PROJECT_TOO_LARGE' });
        try {
            text = decodeUtf8(bytes);
        } catch (error) {
            throw new ExportFormatError('Project JSON is not valid UTF-8.', { cause: error });
        }
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new ExportFormatError('Project file is not valid JSON.', { cause: error });
    }
    return validatedProject(parsed, validateProject);
}

export function createProjectJsonBlob(project, options) {
    const BlobClass = globalThis.Blob;
    if (typeof BlobClass !== 'function') throw new ExportFormatError('Blob is unavailable in this runtime.');
    return new BlobClass([exportProjectJson(project, options)], { type: 'application/json' });
}

export async function importProjectJsonBlob(blob, options = {}) {
    if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isInteger(blob.size)) throw new TypeError('A Blob is required.');
    if (blob.size > (options.maxBytes ?? PROJECT_JSON_MAX_BYTES)) {
        throw new ExportFormatError('Project JSON exceeds the size limit.', { code: 'PROJECT_TOO_LARGE' });
    }
    return importProjectJson(await blob.arrayBuffer(), options);
}

function clampMidi(value) {
    return Math.max(0, Math.min(127, Math.round(value)));
}

function midiMetaEvent(type, data) {
    const bytes = toUint8Array(data);
    return concatBytes(Uint8Array.of(0xff, type), encodeVariableLengthQuantity(bytes.length), bytes);
}

function midiChunk(type, data) {
    const bytes = toUint8Array(data);
    return concatBytes(asciiBytes(type), uint32BigEndian(bytes.length), bytes);
}

function serializeMidiTrack(events, endTick) {
    events.sort((first, second) => first.tick - second.tick || first.priority - second.priority);
    const parts = [];
    let previousTick = 0;
    for (const event of events) {
        const tick = Math.max(previousTick, Math.round(event.tick));
        parts.push(encodeVariableLengthQuantity(tick - previousTick), event.bytes);
        previousTick = tick;
    }
    const finalTick = Math.max(previousTick, Math.round(endTick));
    parts.push(encodeVariableLengthQuantity(finalTick - previousTick), Uint8Array.of(0xff, 0x2f, 0x00));
    return midiChunk('MTrk', concatBytes(parts));
}

function buildConductorTrack(tempo, endTick) {
    const microseconds = Math.round(60_000_000 / tempo);
    const tempoBytes = Uint8Array.of((microseconds >>> 16) & 0xff, (microseconds >>> 8) & 0xff, microseconds & 0xff);
    return serializeMidiTrack([
        { tick: 0, priority: 0, bytes: midiMetaEvent(0x03, encodeUtf8('DM99 Conductor')) },
        { tick: 0, priority: 1, bytes: midiMetaEvent(0x51, tempoBytes) },
        { tick: 0, priority: 2, bytes: midiMetaEvent(0x58, Uint8Array.of(4, 2, 24, 8)) },
    ], endTick);
}

function channelForTonalTrack(index) {
    const channels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
    return channels[index % channels.length];
}

export function exportProjectMidi(project, {
    ppq = MIDI_PPQ,
    gate = 0.72,
    includeMuted = true,
    validateProject = normalizeProjectDocument,
} = {}) {
    if (!Number.isInteger(ppq) || ppq < 24 || ppq > 0x7fff || ppq % 4 !== 0) throw new RangeError('MIDI PPQ must be a multiple of four from 24 to 32767.');
    if (typeof gate !== 'number' || gate <= 0 || gate > 1) throw new RangeError('MIDI gate must be greater than zero and at most one.');
    const normalized = validatedProject(project, validateProject);
    const ticksPerStep = ppq / 4;
    const stepCount = normalized.sequenceLength;
    const swingTicks = (stepIndex) => stepIndex % 2 === 1
        ? Math.round((normalized.swing / 100) * (ticksPerStep / 2))
        : 0;
    const endTick = stepCount * ticksPerStep + swingTicks(stepCount - 1);
    const tracks = [buildConductorTrack(normalized.tempo, endTick)];
    let tonalIndex = 0;

    for (const [trackId, steps] of Object.entries(normalized.sequences)) {
        if (!includeMuted && normalized.muted?.[trackId]) continue;
        const isDrum = Object.hasOwn(GM_DRUM_NOTES, trackId);
        const channel = isDrum ? 9 : channelForTonalTrack(tonalIndex++);
        const events = [{ tick: 0, priority: 0, bytes: midiMetaEvent(0x03, encodeUtf8(trackId.slice(0, 64))) }];
        if (!isDrum) {
            const program = TONAL_PROGRAMS[trackId] ?? 80;
            events.push({ tick: 0, priority: 1, bytes: Uint8Array.of(0xc0 | channel, clampMidi(program)) });
        }

        for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
            const step = steps[stepIndex];
            if (!step.active) continue;
            const ratchet = Math.max(1, Math.min(8, step.ratchet || 1));
            const spacing = ticksPerStep / ratchet;
            const note = isDrum
                ? GM_DRUM_NOTES[trackId]
                : clampMidi((TONAL_BASE_NOTES[trackId] ?? 60) + step.pitch);
            const velocity = Math.max(1, clampMidi(step.velocity * 127));
            const rawNudgeTicks = Math.round((step.nudgeMs / 1000) * (normalized.tempo / 60) * ppq);
            const nudgeLimit = Math.max(0, Math.floor(ticksPerStep / 2) - 1);
            const nudgeTicks = Math.max(-nudgeLimit, Math.min(nudgeLimit, rawNudgeTicks));
            const stepTick = Math.max(0, stepIndex * ticksPerStep + swingTicks(stepIndex) + nudgeTicks);
            for (let hit = 0; hit < ratchet; hit += 1) {
                const noteOnTick = Math.round(stepTick + hit * spacing);
                const noteOffTick = noteOnTick + Math.max(1, Math.floor(spacing * gate));
                events.push({ tick: noteOnTick, priority: 3, bytes: Uint8Array.of(0x90 | channel, note, velocity) });
                events.push({ tick: noteOffTick, priority: 2, bytes: Uint8Array.of(0x80 | channel, note, 0) });
            }
        }
        tracks.push(serializeMidiTrack(events, endTick));
    }

    const header = midiChunk('MThd', concatBytes(uint16BigEndian(1), uint16BigEndian(tracks.length), uint16BigEndian(ppq)));
    return concatBytes(header, tracks);
}

function parseMidiTrack(bytes, start, end, limits, state) {
    let offset = start;
    let tick = 0;
    let runningStatus = null;
    let trackName = '';
    const noteOns = [];

    while (offset < end) {
        if (++state.eventCount > limits.maxEvents) throw new ExportFormatError('MIDI event limit exceeded.', { code: 'MIDI_LIMIT_EXCEEDED' });
        const deltaResult = readVariableLengthQuantity(bytes, offset, { endOffset: end });
        tick += deltaResult.value;
        offset = deltaResult.offset;
        if (tick > limits.maxTicks) throw new ExportFormatError('MIDI tick limit exceeded.', { code: 'MIDI_LIMIT_EXCEEDED' });
        if (offset >= end) throw new ExportFormatError('MIDI track is truncated.');

        let status = bytes[offset];
        if (status < 0x80) {
            if (runningStatus === null) throw new ExportFormatError('MIDI running status has no prior channel event.');
            status = runningStatus;
        } else {
            offset += 1;
        }

        if (status === 0xff) {
            runningStatus = null;
            if (offset >= end) throw new ExportFormatError('MIDI meta event is truncated.');
            const type = bytes[offset++];
            const lengthResult = readVariableLengthQuantity(bytes, offset, { endOffset: end });
            offset = lengthResult.offset;
            if (offset + lengthResult.value > end) throw new ExportFormatError('MIDI meta event exceeds its track.');
            const data = bytes.subarray(offset, offset + lengthResult.value);
            offset += lengthResult.value;
            if (type === 0x03 && !trackName) trackName = decodeUtf8(data, { fatal: false }).slice(0, 128);
            if (type === 0x51 && data.length === 3) {
                const microseconds = (data[0] << 16) | (data[1] << 8) | data[2];
                if (microseconds > 0 && state.tempoMicroseconds === null) state.tempoMicroseconds = microseconds;
            }
            if (type === 0x2f) break;
            continue;
        }

        if (status === 0xf0 || status === 0xf7) {
            runningStatus = null;
            const lengthResult = readVariableLengthQuantity(bytes, offset, { endOffset: end });
            offset = lengthResult.offset + lengthResult.value;
            if (offset > end) throw new ExportFormatError('MIDI SysEx event exceeds its track.');
            continue;
        }

        if (status < 0x80 || status > 0xef) throw new ExportFormatError('Unsupported MIDI status byte.');
        runningStatus = status;
        const eventType = status & 0xf0;
        const channel = status & 0x0f;
        const dataLength = eventType === 0xc0 || eventType === 0xd0 ? 1 : 2;
        if (offset + dataLength > end) throw new ExportFormatError('MIDI channel event is truncated.');
        const first = bytes[offset++];
        const second = dataLength === 2 ? bytes[offset++] : 0;
        if (first > 127 || second > 127) throw new ExportFormatError('MIDI data byte is outside the 7-bit range.');
        if (eventType === 0x90 && second > 0) noteOns.push({ tick, channel, note: first, velocity: second });
    }
    return { name: trackName, noteOns };
}

function emptyStep() {
    return {
        active: false,
        pitch: 0,
        scale: 'minor',
        velocity: 1,
        probability: 1,
        ratchet: 1,
        nudgeMs: 0,
        accent: false,
        slide: false,
    };
}

function resolveImportedTrack(track, note, fallbackIndex) {
    if (note.channel === 9) return DRUM_NOTE_TO_TRACK.get(note.note) || null;
    const named = TRACK_ID_CASE_MAP.get(track.name.trim().toLowerCase());
    if (named && Object.hasOwn(TONAL_BASE_NOTES, named)) return named;
    return TONAL_TRACK_IDS[fallbackIndex % TONAL_TRACK_IDS.length];
}

export function importProjectMidi(input, {
    maxBytes = MIDI_MAX_BYTES,
    maxTracks = 64,
    maxEvents = 100_000,
    maxTicks = 0x0fffffff,
    name = 'Imported MIDI',
} = {}) {
    const bytes = toUint8Array(input, 'MIDI file');
    if (bytes.byteLength > maxBytes) throw new ExportFormatError('MIDI file exceeds the size limit.', { code: 'MIDI_LIMIT_EXCEEDED' });
    if (bytes.length < 14 || readAscii(bytes, 0, 4) !== 'MThd') throw new ExportFormatError('MIDI header is missing.');
    const headerLength = readUint32BigEndian(bytes, 4);
    if (headerLength < 6 || 8 + headerLength > bytes.length) throw new ExportFormatError('MIDI header is invalid.');
    const format = readUint16BigEndian(bytes, 8);
    const trackCount = readUint16BigEndian(bytes, 10);
    const division = readUint16BigEndian(bytes, 12);
    if (format !== 0 && format !== 1) throw new ExportFormatError('Only MIDI format 0 and 1 are supported.');
    if (trackCount < 1 || trackCount > maxTracks) throw new ExportFormatError('MIDI track count exceeds the limit.', { code: 'MIDI_LIMIT_EXCEEDED' });
    if ((division & 0x8000) !== 0 || division < 4) throw new ExportFormatError('SMPTE MIDI timing is unsupported.');

    const state = { eventCount: 0, tempoMicroseconds: null };
    const limits = { maxEvents, maxTicks };
    const parsedTracks = [];
    let offset = 8 + headerLength;
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
        if (offset + 8 > bytes.length || readAscii(bytes, offset, 4) !== 'MTrk') throw new ExportFormatError('MIDI track chunk is missing.');
        const length = readUint32BigEndian(bytes, offset + 4);
        const start = offset + 8;
        const end = start + length;
        if (end > bytes.length) throw new ExportFormatError('MIDI track chunk exceeds the file.');
        parsedTracks.push(parseMidiTrack(bytes, start, end, limits, state));
        offset = end;
    }

    const sequences = Object.fromEntries(ALL_TRACK_IDS.map((trackId) => [
        trackId,
        Array.from({ length: PROJECT_STEP_COUNT }, emptyStep),
    ]));
    const ticksPerStep = division / 4;
    let fallbackTonalIndex = 0;
    let importedHits = 0;
    for (const track of parsedTracks) {
        const isNamedTonal = Object.hasOwn(TONAL_BASE_NOTES, TRACK_ID_CASE_MAP.get(track.name.trim().toLowerCase()) || '');
        const fallbackIndex = fallbackTonalIndex;
        if (track.noteOns.some((event) => event.channel !== 9) && !isNamedTonal) fallbackTonalIndex += 1;
        for (const note of track.noteOns) {
            const trackId = resolveImportedTrack(track, note, fallbackIndex);
            if (!trackId) continue;
            const stepIndex = Math.floor(note.tick / ticksPerStep);
            if (stepIndex < 0 || stepIndex >= PROJECT_STEP_COUNT) continue;
            const step = sequences[trackId][stepIndex];
            if (!step.active) {
                step.active = true;
                step.velocity = note.velocity / 127;
                step.pitch = Object.hasOwn(TONAL_BASE_NOTES, trackId)
                    ? Math.max(-48, Math.min(72, note.note - TONAL_BASE_NOTES[trackId]))
                    : 0;
            } else {
                step.velocity = Math.max(step.velocity, note.velocity / 127);
                step.ratchet = Math.min(8, step.ratchet + 1);
            }
            importedHits += 1;
        }
    }
    if (importedHits === 0) throw new ExportFormatError('MIDI file contains no importable note events.', { code: 'MIDI_EMPTY' });

    const rawTempo = state.tempoMicroseconds ? Math.round(60_000_000 / state.tempoMicroseconds) : 120;
    const tempo = Math.max(40, Math.min(300, rawTempo));
    return normalizeProjectDocument({
        version: PROJECT_STATE_VERSION,
        projectName: String(name).slice(0, 100),
        sequenceLength: PROJECT_STEP_COUNT,
        sequences,
        tempo,
        swing: 0,
        generator: { seed: `midi-${format}-${division}` },
    });
}

function normalizeAudioInput(input, { sampleRate, maxChannels = 32, maxFrames = 86_400_000 } = {}) {
    let channels;
    let resolvedSampleRate = sampleRate;
    if (input && typeof input.getChannelData === 'function') {
        if (!Number.isInteger(input.numberOfChannels) || !Number.isInteger(input.length)) throw new ExportFormatError('AudioBuffer dimensions are invalid.');
        channels = Array.from({ length: input.numberOfChannels }, (_, index) => input.getChannelData(index));
        resolvedSampleRate = resolvedSampleRate ?? input.sampleRate;
    } else if (Array.isArray(input)) {
        channels = input;
    } else if (input && Array.isArray(input.channels)) {
        channels = input.channels;
        resolvedSampleRate = resolvedSampleRate ?? input.sampleRate;
    } else {
        throw new TypeError('Audio input must be an AudioBuffer, channel array, or { channels, sampleRate }.');
    }
    if (!Number.isInteger(resolvedSampleRate) || resolvedSampleRate < 8_000 || resolvedSampleRate > 384_000) {
        throw new ExportFormatError('Audio sample rate must be an integer from 8000 to 384000 Hz.');
    }
    if (channels.length < 1 || channels.length > maxChannels) throw new ExportFormatError('Audio channel count is outside the supported range.');
    const normalizedChannels = channels.map((channel) => {
        if (!ArrayBuffer.isView(channel) || typeof channel.length !== 'number') throw new ExportFormatError('Audio channels must be typed arrays.');
        return channel;
    });
    const frameCount = normalizedChannels[0].length;
    if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > maxFrames) throw new ExportFormatError('Audio frame count is outside the supported range.');
    if (normalizedChannels.some((channel) => channel.length !== frameCount)) throw new ExportFormatError('Audio channels must have equal lengths.');
    return { channels: normalizedChannels, sampleRate: resolvedSampleRate, frameCount };
}

function writeAscii(view, offset, text) {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function clampSample(value) {
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

export function encodeWavPcm(input, {
    sampleRate,
    bitDepth = 16,
    float32 = false,
    maxChannels = 32,
    maxFrames = 86_400_000,
} = {}) {
    const audio = normalizeAudioInput(input, { sampleRate, maxChannels, maxFrames });
    if (float32 && bitDepth !== 32) throw new ExportFormatError('Float WAV encoding requires 32-bit samples.');
    if (!float32 && ![8, 16, 24, 32].includes(bitDepth)) throw new ExportFormatError('PCM bit depth must be 8, 16, 24, or 32.');
    const bytesPerSample = bitDepth / 8;
    const blockAlign = audio.channels.length * bytesPerSample;
    const dataBytes = audio.frameCount * blockAlign;
    if (!Number.isSafeInteger(dataBytes) || dataBytes > 0xffffffff - 36) throw new ExportFormatError('Audio is too large for a RIFF/WAV file.');
    const output = new Uint8Array(44 + dataBytes);
    const view = new DataView(output.buffer);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, float32 ? 3 : 1, true);
    view.setUint16(22, audio.channels.length, true);
    view.setUint32(24, audio.sampleRate, true);
    view.setUint32(28, audio.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let frame = 0; frame < audio.frameCount; frame += 1) {
        for (const channel of audio.channels) {
            const sample = clampSample(channel[frame]);
            if (float32) {
                view.setFloat32(offset, sample, true);
            } else if (bitDepth === 8) {
                view.setUint8(offset, Math.max(0, Math.min(255, Math.round((sample + 1) * 127.5))));
            } else {
                const negativeScale = 2 ** (bitDepth - 1);
                const positiveScale = negativeScale - 1;
                const integer = Math.round(sample < 0 ? sample * negativeScale : sample * positiveScale);
                if (bitDepth === 16) view.setInt16(offset, integer, true);
                else if (bitDepth === 24) {
                    const unsigned = integer < 0 ? integer + 0x1000000 : integer;
                    view.setUint8(offset, unsigned & 0xff);
                    view.setUint8(offset + 1, (unsigned >>> 8) & 0xff);
                    view.setUint8(offset + 2, (unsigned >>> 16) & 0xff);
                } else view.setInt32(offset, integer, true);
            }
            offset += bytesPerSample;
        }
    }
    return output;
}

export function createWavBlob(input, options) {
    const BlobClass = globalThis.Blob;
    if (typeof BlobClass !== 'function') throw new ExportFormatError('Blob is unavailable in this runtime.');
    return new BlobClass([encodeWavPcm(input, options)], { type: 'audio/wav' });
}

function shareableProject(project, validateProject) {
    const normalized = validatedProject(project, validateProject);
    // normalizeProjectState produces a JSON-only state document. User sample Blobs live
    // exclusively in SamplerStore and therefore cannot enter a share fragment.
    return cloneJsonValue(normalized);
}

async function transformStream(bytes, StreamClass, format, maxOutputBytes) {
    if (typeof StreamClass !== 'function' || typeof ReadableStream !== 'function') throw new ExportFormatError(`${format} streams are unavailable.`);
    const source = new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
    const reader = source.pipeThrough(new StreamClass(format)).getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = toUint8Array(value);
        total += chunk.byteLength;
        if (total > maxOutputBytes) {
            await reader.cancel('Output limit exceeded.');
            throw new ExportFormatError('Shared pattern exceeds the decoded size limit.', { code: 'SHARE_TOO_LARGE' });
        }
        chunks.push(chunk);
    }
    return concatBytes(chunks);
}

function safeGlobal(name) {
    try {
        return globalThis[name];
    } catch {
        return undefined;
    }
}

export async function createPatternShareFragment(project, {
    compress = true,
    compressionStream = safeGlobal('CompressionStream'),
    maxChars = SHARE_FRAGMENT_MAX_CHARS,
    validateProject = normalizeProjectDocument,
} = {}) {
    const json = JSON.stringify(shareableProject(project, validateProject));
    const raw = encodeUtf8(json);
    let mode = 'j';
    let payload = raw;
    if (compress && typeof compressionStream === 'function') {
        const compressed = await transformStream(raw, compressionStream, 'gzip', PROJECT_JSON_MAX_BYTES);
        if (compressed.byteLength < raw.byteLength) {
            mode = 'g';
            payload = compressed;
        }
    }
    const fragment = `#dm99=v1.${mode}.${base64UrlEncode(payload)}`;
    if (fragment.length > maxChars) throw new ExportFormatError('Shared pattern exceeds the URL-fragment limit.', { code: 'SHARE_TOO_LARGE' });
    return fragment;
}

export async function parsePatternShareFragment(fragment, {
    decompressionStream = safeGlobal('DecompressionStream'),
    maxChars = SHARE_FRAGMENT_MAX_CHARS,
    maxBytes = PROJECT_JSON_MAX_BYTES,
    validateProject = normalizeProjectDocument,
} = {}) {
    if (typeof fragment !== 'string' || fragment.length > maxChars) throw new ExportFormatError('Shared pattern fragment is invalid.', { code: 'INVALID_SHARE' });
    const normalizedFragment = fragment.startsWith('#') ? fragment : `#${fragment}`;
    const match = /^#dm99=v1\.([gj])\.([A-Za-z0-9_-]+)$/u.exec(normalizedFragment);
    if (!match) throw new ExportFormatError('Shared pattern fragment is unsupported.', { code: 'INVALID_SHARE' });
    const packed = base64UrlDecode(match[2], { maxBytes });
    const raw = match[1] === 'g'
        ? await transformStream(packed, decompressionStream, 'gzip', maxBytes)
        : packed;
    return importProjectJson(raw, { maxBytes, validateProject });
}

export const exportMidi = exportProjectMidi;
export const importMidi = importProjectMidi;
export const encodeWav = encodeWavPcm;

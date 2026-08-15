import assert from 'node:assert/strict';
import test from 'node:test';

import {
    base64UrlDecode,
    base64UrlEncode,
    encodeVariableLengthQuantity,
    readAscii,
    readVariableLengthQuantity,
} from '../src/binary-utils.js';
import {
    ExportFormatError,
    createPatternShareFragment,
    encodeWavPcm,
    exportProjectJson,
    exportProjectMidi,
    importProjectJson,
    importProjectMidi,
    parsePatternShareFragment,
} from '../src/exporters.js';
import { PROJECT_STATE_VERSION } from '../src/pattern-constants.js';
import { createProjectFixture } from './fixtures/project-fixture.js';

test('binary helpers round-trip base64url and MIDI variable-length quantities', () => {
    const source = Uint8Array.of(0, 1, 2, 127, 128, 254, 255);
    assert.deepEqual(base64UrlDecode(base64UrlEncode(source)), source);
    for (const value of [0, 127, 128, 8192, 0x0fffffff]) {
        const encoded = encodeVariableLengthQuantity(value);
        const decoded = readVariableLengthQuantity(encoded, 0);
        assert.equal(decoded.value, value);
        assert.equal(decoded.offset, encoded.length);
    }
});

test('JSON export/import preserves canonical v3 patterns and expressive steps', () => {
    const fixture = createProjectFixture();
    const json = exportProjectJson(fixture);
    const imported = importProjectJson(json);
    assert.equal(imported.version, PROJECT_STATE_VERSION);
    assert.equal(imported.projectName, 'Fixture Groove');
    assert.equal(imported.patterns.A.kick[0].velocity, 0.8);
    assert.equal(imported.patterns.A.kick[0].accent, true);
    assert.equal(imported.patterns.A.bass1[2].ratchet, 3);
    assert.equal(imported.patterns.A.bass1[2].slide, true);
    assert.equal(imported.patterns.A.synth[8].probability, 0.75);
    assert.equal(imported.patterns.A.synth[8].nudgeMs, -12);
    assert.throws(() => importProjectJson('{oops}'), ExportFormatError);
    assert.throws(() => importProjectJson(json, { maxBytes: 10 }), /size limit/u);
});

test('MIDI exporter writes SMF type 1 with conductor and one track per instrument', () => {
    const midi = exportProjectMidi(createProjectFixture());
    assert.equal(readAscii(midi, 0, 4), 'MThd');
    const view = new DataView(midi.buffer, midi.byteOffset, midi.byteLength);
    assert.equal(view.getUint32(4), 6);
    assert.equal(view.getUint16(8), 1);
    assert.equal(view.getUint16(10), 27);
    assert.equal(view.getUint16(12), 480);

    let offset = 14;
    for (let index = 0; index < 27; index += 1) {
        assert.equal(readAscii(midi, offset, 4), 'MTrk');
        const length = view.getUint32(offset + 4);
        assert.ok(length >= 4);
        offset += 8 + length;
    }
    assert.equal(offset, midi.length);
});

test('bounded MIDI import restores tempo, GM drums, tonal pitches, velocities, and ratchets', () => {
    const midi = exportProjectMidi(createProjectFixture());
    const imported = importProjectMidi(midi);
    assert.equal(imported.version, PROJECT_STATE_VERSION);
    assert.equal(imported.sequenceLength, 32);
    assert.equal(imported.tempo, 132);
    assert.equal(imported.sequences.kick[0].active, true);
    assert.equal(imported.sequences.kick[0].ratchet, 2);
    assert.ok(Math.abs(imported.sequences.kick[0].velocity - (102 / 127)) < 1e-9);
    assert.equal(imported.sequences.snare[4].active, true);
    assert.equal(imported.sequences.bass1[2].active, true);
    assert.equal(imported.sequences.bass1[2].pitch, 7);
    assert.equal(imported.sequences.bass1[2].ratchet, 3);

    assert.throws(() => importProjectMidi(midi, { maxBytes: 10 }), /size limit/u);
    assert.throws(() => importProjectMidi(midi.subarray(0, midi.length - 2)), /track chunk|truncated|exceeds/u);
});

test('WAV PCM encoder accepts channel arrays and AudioBuffer-like render results', () => {
    const left = Float32Array.of(-1, 0, 1);
    const right = Float32Array.of(1, 0, -1);
    const wav = encodeWavPcm({ channels: [left, right], sampleRate: 8000 }, { bitDepth: 16 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(readAscii(wav, 0, 4), 'RIFF');
    assert.equal(readAscii(wav, 8, 4), 'WAVE');
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getUint32(24, true), 8000);
    assert.equal(view.getUint32(28, true), 32000);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(40, true), 12);
    assert.deepEqual(
        Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true)),
        [-32768, 32767, 0, 0, 32767, -32768],
    );

    const audioBufferLike = {
        numberOfChannels: 1,
        length: left.length,
        sampleRate: 44100,
        getChannelData(index) {
            assert.equal(index, 0);
            return left;
        },
    };
    const rendered = encodeWavPcm(audioBufferLike, { float32: true, bitDepth: 32 });
    const renderedView = new DataView(rendered.buffer, rendered.byteOffset, rendered.byteLength);
    assert.equal(renderedView.getUint16(20, true), 3);
    assert.equal(renderedView.getFloat32(44, true), -1);
});

test('URL-fragment sharing compresses canonical state and never accepts audio blobs', async () => {
    const fixture = createProjectFixture();
    const fragment = await createPatternShareFragment(fixture);
    assert.match(fragment, /^#dm99=v1\.[gj]\.[A-Za-z0-9_-]+$/u);
    const parsed = await parsePatternShareFragment(fragment);
    assert.equal(parsed.projectName, fixture.projectName);
    assert.equal(parsed.patterns.A.bass1[2].ratchet, 3);
    assert.equal(parsed.patterns.A.synth[8].nudgeMs, -12);

    const unsafe = createProjectFixture();
    unsafe.audioBlobs = { kick: new Blob([Uint8Array.of(1)], { type: 'audio/wav' }) };
    await assert.rejects(createPatternShareFragment(unsafe), /plain object|JSON-safe/u);
    await assert.rejects(parsePatternShareFragment('#dm99=v9.j.AA'), /unsupported/u);
});

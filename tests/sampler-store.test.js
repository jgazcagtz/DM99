import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MemorySampleAdapter,
    SampleQuotaError,
    SampleValidationError,
    SamplerStore,
    openSamplerStore,
} from '../src/sampler-store.js';

test('sampler store persists defensive Blob records and lists metadata without audio payloads', async () => {
    const store = new SamplerStore(new MemorySampleAdapter(), {
        maxSampleBytes: 1024,
        maxLibraryBytes: 4096,
        now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const metadata = { source: 'user', rootMidi: 60 };
    const blob = new Blob([Uint8Array.of(1, 2, 3, 4)], { type: 'audio/wav' });
    const saved = await store.putSample(blob, { id: 'user-kick', name: 'My Kick', metadata });
    metadata.rootMidi = 20;

    assert.equal(saved.size, 4);
    assert.notEqual(saved.blob, blob);
    assert.deepEqual(new Uint8Array(await saved.blob.arrayBuffer()), Uint8Array.of(1, 2, 3, 4));
    const fetched = await store.getSample('user-kick');
    assert.equal(fetched.metadata.rootMidi, 60);
    fetched.metadata.rootMidi = 10;
    assert.equal((await store.getSample('user-kick')).metadata.rootMidi, 60);

    const listed = await store.listSamples();
    assert.equal(listed.length, 1);
    assert.equal(Object.hasOwn(listed[0], 'blob'), false);
    assert.deepEqual(await store.getUsage(), { sampleCount: 1, bytes: 4, maxLibraryBytes: 4096 });
});

test('sample replacement accounts for replaced bytes and delete releases usage', async () => {
    const store = new SamplerStore(new MemorySampleAdapter(), {
        maxSampleBytes: 10,
        maxLibraryBytes: 12,
    });
    await store.putSample(new Blob([new Uint8Array(8)], { type: 'audio/wav' }), { id: 'one', name: 'One' });
    await store.putSample(new Blob([new Uint8Array(10)], { type: 'audio/wav' }), { id: 'one', name: 'Replacement' });
    assert.equal((await store.getUsage()).bytes, 10);
    await assert.rejects(
        store.putSample(new Blob([new Uint8Array(3)], { type: 'audio/wav' }), { id: 'two', name: 'Two' }),
        SampleQuotaError,
    );
    await store.deleteSample('one');
    assert.equal((await store.getUsage()).bytes, 0);
});

test('sampler store rejects empty, oversized, non-audio, and headroom-exhausting samples', async () => {
    const store = new SamplerStore(new MemorySampleAdapter(), {
        maxSampleBytes: 8,
        maxLibraryBytes: 100,
        estimateStorage: async () => ({ usage: 90, quota: 100 }),
    });
    await assert.rejects(
        store.putSample(new Blob([], { type: 'audio/wav' }), { id: 'empty', name: 'Empty' }),
        SampleValidationError,
    );
    await assert.rejects(
        store.putSample(new Blob([new Uint8Array(9)], { type: 'audio/wav' }), { id: 'large', name: 'Large' }),
        SampleQuotaError,
    );
    await assert.rejects(
        store.putSample(new Blob([Uint8Array.of(1)], { type: 'text/plain' }), { id: 'text', name: 'Text' }),
        SampleValidationError,
    );
    await assert.rejects(
        store.putSample(new Blob([Uint8Array.of(1)], { type: 'audio/wav' }), { id: 'quota', name: 'Quota' }),
        SampleQuotaError,
    );
});

test('adapter QuotaExceededError is surfaced as SampleQuotaError', async () => {
    class QuotaAdapter extends MemorySampleAdapter {
        async put() {
            const error = new Error('full');
            error.name = 'QuotaExceededError';
            throw error;
        }
    }
    const observed = [];
    const store = new SamplerStore(new QuotaAdapter(), {
        maxSampleBytes: 10,
        maxLibraryBytes: 20,
        onError(error) { observed.push(error); },
    });
    await assert.rejects(
        store.putSample(new Blob([Uint8Array.of(1)], { type: 'audio/wav' }), { id: 'quota', name: 'Quota' }),
        SampleQuotaError,
    );
    assert.equal(observed.length, 1);
    assert.equal(observed[0].code, 'SAMPLE_QUOTA_EXCEEDED');
});

test('openSamplerStore uses an explicit ephemeral fallback and can require persistence', async () => {
    const store = await openSamplerStore({ indexedDB: null });
    assert.equal(store.storageKind, 'memory');
    assert.equal(store.persistent, false);
    await assert.rejects(
        openSamplerStore({ indexedDB: null, requirePersistent: true }),
        /IndexedDB is required/u,
    );
});

import { cloneJsonValue } from './project-store.js';

export const DEFAULT_MAX_SAMPLE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_SAMPLE_LIBRARY_BYTES = 100 * 1024 * 1024;

const DEFAULT_DB_NAME = 'dm99-samples';
const SAFE_SAMPLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export class SampleStoreError extends Error {
    constructor(message, { code = 'SAMPLE_STORE_ERROR', cause, details } = {}) {
        super(message, { cause });
        this.name = 'SampleStoreError';
        this.code = code;
        if (details) this.details = details;
    }
}

export class SampleValidationError extends SampleStoreError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'INVALID_SAMPLE' });
        this.name = 'SampleValidationError';
    }
}

export class SampleQuotaError extends SampleStoreError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'SAMPLE_QUOTA_EXCEEDED' });
        this.name = 'SampleQuotaError';
    }
}

function isBlobLike(value) {
    return value !== null
        && typeof value === 'object'
        && Number.isInteger(value.size)
        && value.size >= 0
        && typeof value.type === 'string'
        && typeof value.slice === 'function'
        && typeof value.arrayBuffer === 'function';
}

function normalizeId(value) {
    if (typeof value !== 'string' || !SAFE_SAMPLE_ID.test(value)) throw new SampleValidationError('Sample id is invalid.');
    return value;
}

function normalizeName(value) {
    const name = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
    if (!name || name.length > 160) throw new SampleValidationError('Sample name must contain 1 to 160 characters.');
    return name;
}

function defaultIdFactory() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `sample-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneBlob(blob) {
    return blob.slice(0, blob.size, blob.type);
}

function cloneRecord(record, { includeBlob = true } = {}) {
    if (!record) return null;
    const output = {
        id: record.id,
        name: record.name,
        mimeType: record.mimeType,
        size: record.size,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        metadata: cloneJsonValue(record.metadata || {}, { maxDepth: 8, maxNodes: 10_000 }),
    };
    if (includeBlob) output.blob = cloneBlob(record.blob);
    return output;
}

function requestPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB sample request failed.'));
    });
}

function openDatabasePromise(request, blockedMessage) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB open request failed.'));
        request.onblocked = () => reject(new Error(blockedMessage));
    });
}

function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB sample transaction aborted.'));
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB sample transaction failed.'));
    });
}

export class MemorySampleAdapter {
    constructor() {
        this.kind = 'memory';
        this.persistent = false;
        this.samples = new Map();
    }
    async get(id) { return cloneRecord(this.samples.get(id)); }
    async list() { return [...this.samples.values()].map((record) => cloneRecord(record)); }
    async put(record) { this.samples.set(record.id, cloneRecord(record)); }
    async delete(id) { this.samples.delete(id); }
    async clear() { this.samples.clear(); }
}

export class IndexedDbSampleAdapter {
    constructor(database) {
        this.kind = 'indexedDB';
        this.persistent = true;
        this.database = database;
    }

    static async open(indexedDBFactory, { dbName = DEFAULT_DB_NAME } = {}) {
        if (!indexedDBFactory || typeof indexedDBFactory.open !== 'function') throw new SampleStoreError('IndexedDB is unavailable.');
        let request;
        try {
            request = indexedDBFactory.open(dbName, 1);
        } catch (error) {
            throw new SampleStoreError('Could not open IndexedDB sample storage.', { cause: error });
        }
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains('samples')) {
                const store = database.createObjectStore('samples', { keyPath: 'id' });
                store.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
        };
        try {
            return new IndexedDbSampleAdapter(await openDatabasePromise(request, 'IndexedDB sample upgrade is blocked by another tab.'));
        } catch (error) {
            throw new SampleStoreError('Could not open IndexedDB sample storage.', { cause: error });
        }
    }

    async _request(mode, operation) {
        try {
            const transaction = this.database.transaction(['samples'], mode);
            const done = transactionPromise(transaction);
            const result = await operation(transaction.objectStore('samples'));
            await done;
            return result;
        } catch (error) {
            if (error?.name === 'QuotaExceededError' || error?.cause?.name === 'QuotaExceededError') {
                throw new SampleQuotaError('Browser storage quota was exceeded.', { cause: error });
            }
            throw new SampleStoreError('IndexedDB sample operation failed.', { cause: error });
        }
    }

    async get(id) { return this._request('readonly', (store) => requestPromise(store.get(id))); }
    async list() { return this._request('readonly', (store) => requestPromise(store.getAll())); }
    async put(record) { return this._request('readwrite', (store) => requestPromise(store.put(record))); }
    async delete(id) { return this._request('readwrite', (store) => requestPromise(store.delete(id))); }
    async clear() { return this._request('readwrite', (store) => requestPromise(store.clear())); }
    close() { this.database.close(); }
}

export class SamplerStore {
    constructor(adapter, {
        maxSampleBytes = DEFAULT_MAX_SAMPLE_BYTES,
        maxLibraryBytes = DEFAULT_MAX_SAMPLE_LIBRARY_BYTES,
        quotaHeadroom = 0.1,
        allowUnknownMime = false,
        estimateStorage,
        idFactory = defaultIdFactory,
        now = () => new Date(),
        onError,
    } = {}) {
        if (!adapter) throw new SampleStoreError('A sample storage adapter is required.');
        if (!Number.isInteger(maxSampleBytes) || maxSampleBytes < 1) throw new RangeError('maxSampleBytes is invalid.');
        if (!Number.isInteger(maxLibraryBytes) || maxLibraryBytes < maxSampleBytes) throw new RangeError('maxLibraryBytes is invalid.');
        if (typeof quotaHeadroom !== 'number' || quotaHeadroom < 0 || quotaHeadroom >= 1) throw new RangeError('quotaHeadroom is invalid.');
        this.adapter = adapter;
        this.storageKind = adapter.kind || 'custom';
        this.persistent = adapter.persistent !== false;
        this.maxSampleBytes = maxSampleBytes;
        this.maxLibraryBytes = maxLibraryBytes;
        this.quotaHeadroom = quotaHeadroom;
        this.allowUnknownMime = allowUnknownMime;
        this.estimateStorage = estimateStorage;
        this.idFactory = idFactory;
        this.now = now;
        this.onError = onError;
        this.fallbackError = null;
    }

    _timestamp() {
        const value = this.now();
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) throw new SampleStoreError('Clock returned an invalid timestamp.');
        return date.toISOString();
    }

    async _usageRecords() {
        const records = await this.adapter.list();
        return {
            records,
            bytes: records.reduce((total, record) => total + record.size, 0),
        };
    }

    async _assertQuota(incomingBytes, replacingBytes = 0) {
        const usage = await this._usageRecords();
        const projectedLibraryBytes = usage.bytes - replacingBytes + incomingBytes;
        if (projectedLibraryBytes > this.maxLibraryBytes) {
            throw new SampleQuotaError('Sample library size limit would be exceeded.', {
                details: { projectedLibraryBytes, maxLibraryBytes: this.maxLibraryBytes },
            });
        }
        if (typeof this.estimateStorage === 'function') {
            let estimate;
            try {
                estimate = await this.estimateStorage();
            } catch (error) {
                if (typeof this.onError === 'function') this.onError(new SampleStoreError('Storage quota estimate failed.', { cause: error }));
                return;
            }
            if (Number.isFinite(estimate?.quota) && estimate.quota > 0 && Number.isFinite(estimate?.usage)) {
                const projectedBrowserUsage = estimate.usage + Math.max(0, incomingBytes - replacingBytes);
                const usableQuota = estimate.quota * (1 - this.quotaHeadroom);
                if (projectedBrowserUsage > usableQuota) {
                    throw new SampleQuotaError('Browser storage headroom would be exhausted.', {
                        details: { projectedBrowserUsage, usableQuota, quota: estimate.quota },
                    });
                }
            }
        }
    }

    async putSample(blob, { id, name, metadata = {} } = {}) {
        if (!isBlobLike(blob)) throw new SampleValidationError('Sample data must be a Blob.');
        if (blob.size < 1) throw new SampleValidationError('Sample Blob is empty.');
        if (blob.size > this.maxSampleBytes) {
            throw new SampleQuotaError('Sample exceeds the per-file size limit.', {
                details: { size: blob.size, maxSampleBytes: this.maxSampleBytes },
            });
        }
        const mimeType = blob.type.toLowerCase();
        if ((!mimeType || !mimeType.startsWith('audio/')) && !this.allowUnknownMime) {
            throw new SampleValidationError('Sample Blob must use an audio/* MIME type.');
        }
        const sampleId = normalizeId(id || this.idFactory());
        const sampleName = normalizeName(name || blob.name || 'User sample');
        const existing = await this.adapter.get(sampleId);
        await this._assertQuota(blob.size, existing?.size || 0);
        const timestamp = this._timestamp();
        const record = {
            id: sampleId,
            name: sampleName,
            mimeType,
            size: blob.size,
            createdAt: existing?.createdAt || timestamp,
            updatedAt: timestamp,
            metadata: cloneJsonValue(metadata, { maxDepth: 8, maxNodes: 10_000 }),
            blob: cloneBlob(blob),
        };
        try {
            await this.adapter.put(record);
            return cloneRecord(record);
        } catch (error) {
            const wrapped = error instanceof SampleStoreError
                ? error
                : error?.name === 'QuotaExceededError'
                    ? new SampleQuotaError('Browser storage quota was exceeded.', { cause: error })
                    : new SampleStoreError('Could not store sample.', { cause: error });
            if (typeof this.onError === 'function') this.onError(wrapped);
            throw wrapped;
        }
    }

    async getSample(id) {
        return cloneRecord(await this.adapter.get(normalizeId(id)));
    }

    async getSampleBlob(id) {
        const sample = await this.getSample(id);
        return sample?.blob || null;
    }

    async listSamples() {
        const records = await this.adapter.list();
        return records
            .map((record) => cloneRecord(record, { includeBlob: false }))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async deleteSample(id) { await this.adapter.delete(normalizeId(id)); }
    async clearSamples() { await this.adapter.clear(); }

    async getUsage() {
        const { records, bytes } = await this._usageRecords();
        return { sampleCount: records.length, bytes, maxLibraryBytes: this.maxLibraryBytes };
    }

    close() { if (typeof this.adapter.close === 'function') this.adapter.close(); }
}

function safeGlobal(name) {
    try {
        return globalThis[name];
    } catch {
        return undefined;
    }
}

function defaultEstimateStorage() {
    const navigatorApi = safeGlobal('navigator');
    return typeof navigatorApi?.storage?.estimate === 'function'
        ? () => navigatorApi.storage.estimate()
        : undefined;
}

export async function openSamplerStore(options = {}) {
    let adapter = options.adapter;
    let fallbackError = null;
    if (!adapter) {
        const indexedDBFactory = Object.hasOwn(options, 'indexedDB')
            ? options.indexedDB
            : safeGlobal('indexedDB');
        if (indexedDBFactory) {
            try {
                adapter = await IndexedDbSampleAdapter.open(indexedDBFactory, { dbName: options.dbName });
            } catch (error) {
                fallbackError = error;
                if (typeof options.onError === 'function') options.onError(error);
                if (options.requirePersistent) throw error;
            }
        } else if (options.requirePersistent) {
            throw new SampleStoreError('IndexedDB is required for persistent sample storage.', { code: 'INDEXEDDB_UNAVAILABLE' });
        }
    }
    if (!adapter) adapter = new MemorySampleAdapter();
    const store = new SamplerStore(adapter, {
        ...options,
        estimateStorage: options.estimateStorage ?? defaultEstimateStorage(),
    });
    store.fallbackError = fallbackError;
    return store;
}

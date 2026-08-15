import { normalizeProjectState } from './project-state.js';

export const PROJECT_STEP_COUNT = 32;
export const LEGACY_PATTERN_KEY = 'dm99-pattern';

const DEFAULT_LOCAL_STORAGE_KEY = 'dm99-project-store-v1';
const DEFAULT_DB_NAME = 'dm99-projects';
const DEFAULT_MAX_REVISIONS = 20;
const MAX_PROJECT_JSON_BYTES = 1_000_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export class ProjectStoreError extends Error {
    constructor(message, { code = 'PROJECT_STORE_ERROR', cause } = {}) {
        super(message, { cause });
        this.name = 'ProjectStoreError';
        this.code = code;
    }
}

export class ProjectValidationError extends ProjectStoreError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'INVALID_PROJECT' });
        this.name = 'ProjectValidationError';
    }
}

export class ProjectStorageError extends ProjectStoreError {
    constructor(message, options = {}) {
        super(message, { ...options, code: options.code || 'PROJECT_STORAGE_ERROR' });
        this.name = 'ProjectStorageError';
    }
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function cloneJsonValue(value, { maxDepth = 20, maxNodes = 300_000 } = {}) {
    const active = new Set();
    let nodes = 0;

    function clone(current, path, depth) {
        nodes += 1;
        if (nodes > maxNodes) throw new ProjectValidationError('Project contains too many values.');
        if (depth > maxDepth) throw new ProjectValidationError(`Project value at ${path} is nested too deeply.`);
        if (current === null || typeof current === 'string' || typeof current === 'boolean') return current;
        if (typeof current === 'number') {
            if (!Number.isFinite(current)) throw new ProjectValidationError(`Project number at ${path} must be finite.`);
            return current;
        }
        if (typeof current !== 'object') throw new ProjectValidationError(`Project value at ${path} is not JSON-safe.`);
        if (active.has(current)) throw new ProjectValidationError(`Project contains a cycle at ${path}.`);
        active.add(current);
        let output;
        if (Array.isArray(current)) {
            output = current.map((item, index) => clone(item, `${path}[${index}]`, depth + 1));
        } else {
            if (!isPlainObject(current)) throw new ProjectValidationError(`Project value at ${path} must be a plain object.`);
            output = {};
            for (const [key, item] of Object.entries(current)) {
                if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
                    throw new ProjectValidationError(`Unsafe project key at ${path}.${key}.`);
                }
                output[key] = clone(item, `${path}.${key}`, depth + 1);
            }
        }
        active.delete(current);
        return output;
    }

    return clone(value, '$', 0);
}

export function normalizeProjectDocument(input, { stepCount } = {}) {
    if (!isPlainObject(input)) throw new ProjectValidationError('Project must be a plain object.');
    let normalized;
    try {
        normalized = normalizeProjectState(cloneJsonValue(input));
    } catch (error) {
        throw new ProjectValidationError('Project state is invalid or from an unsupported version.', { cause: error });
    }
    if (stepCount !== undefined) {
        if (!Number.isInteger(stepCount) || stepCount < 1 || stepCount > 256) throw new ProjectValidationError('stepCount is invalid.');
        if (normalized.sequenceLength !== stepCount) {
            throw new ProjectValidationError(`Project must contain exactly ${stepCount} steps per track.`);
        }
    }
    return cloneJsonValue(normalized);
}

function cloneRecord(value) {
    return value === undefined ? undefined : cloneJsonValue(value);
}

export class MemoryProjectAdapter {
    constructor() {
        this.kind = 'memory';
        this.persistent = false;
        this.projects = new Map();
        this.revisions = new Map();
        this.meta = new Map();
    }

    async getProject(id) { return cloneRecord(this.projects.get(id)); }
    async listProjects() { return [...this.projects.values()].map(cloneRecord); }
    async putProjectWithRevision(project, revision) {
        this.projects.set(project.id, cloneRecord(project));
        this.revisions.set(revision.key, cloneRecord(revision));
    }
    async deleteProject(id) {
        this.projects.delete(id);
        for (const [key, revision] of this.revisions) if (revision.projectId === id) this.revisions.delete(key);
    }
    async listRevisions(projectId) {
        return [...this.revisions.values()].filter((item) => item.projectId === projectId).map(cloneRecord);
    }
    async deleteRevision(key) { this.revisions.delete(key); }
    async getMeta(key) { return cloneRecord(this.meta.get(key)); }
    async setMeta(key, value) { this.meta.set(key, cloneRecord(value)); }
}

export class LocalStorageProjectAdapter {
    constructor(storage, { storageKey = DEFAULT_LOCAL_STORAGE_KEY } = {}) {
        if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
            throw new ProjectStorageError('A Storage-compatible object is required.');
        }
        this.kind = 'localStorage';
        this.persistent = true;
        this.storage = storage;
        this.storageKey = storageKey;
    }

    _read() {
        try {
            const raw = this.storage.getItem(this.storageKey);
            if (!raw) return { version: 1, projects: {}, revisions: {}, meta: {} };
            if (raw.length > 5_000_000) throw new ProjectStorageError('Local project store exceeds its safety limit.');
            const parsed = JSON.parse(raw);
            if (!isPlainObject(parsed) || !isPlainObject(parsed.projects) || !isPlainObject(parsed.revisions) || !isPlainObject(parsed.meta)) {
                throw new ProjectStorageError('Local project store is corrupt.');
            }
            return parsed;
        } catch (error) {
            if (error instanceof ProjectStoreError) throw error;
            throw new ProjectStorageError('Could not read local project storage.', { cause: error });
        }
    }

    _write(state) {
        try {
            this.storage.setItem(this.storageKey, JSON.stringify(state));
        } catch (error) {
            const code = error?.name === 'QuotaExceededError' ? 'PROJECT_QUOTA_EXCEEDED' : 'PROJECT_STORAGE_ERROR';
            throw new ProjectStorageError('Could not write local project storage.', { code, cause: error });
        }
    }

    async getProject(id) { return cloneRecord(this._read().projects[id]); }
    async listProjects() { return Object.values(this._read().projects).map(cloneRecord); }
    async putProjectWithRevision(project, revision) {
        const state = this._read();
        state.projects[project.id] = cloneRecord(project);
        state.revisions[revision.key] = cloneRecord(revision);
        this._write(state);
    }
    async deleteProject(id) {
        const state = this._read();
        delete state.projects[id];
        for (const [key, revision] of Object.entries(state.revisions)) if (revision.projectId === id) delete state.revisions[key];
        this._write(state);
    }
    async listRevisions(projectId) {
        return Object.values(this._read().revisions).filter((item) => item.projectId === projectId).map(cloneRecord);
    }
    async deleteRevision(key) {
        const state = this._read();
        delete state.revisions[key];
        this._write(state);
    }
    async getMeta(key) { return cloneRecord(this._read().meta[key]); }
    async setMeta(key, value) {
        const state = this._read();
        state.meta[key] = cloneRecord(value);
        this._write(state);
    }
}

function requestPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
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
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    });
}

export class IndexedDbProjectAdapter {
    constructor(database) {
        this.kind = 'indexedDB';
        this.persistent = true;
        this.database = database;
    }

    static async open(indexedDBFactory, { dbName = DEFAULT_DB_NAME } = {}) {
        if (!indexedDBFactory || typeof indexedDBFactory.open !== 'function') throw new ProjectStorageError('IndexedDB is unavailable.');
        let request;
        try {
            request = indexedDBFactory.open(dbName, 1);
        } catch (error) {
            throw new ProjectStorageError('Could not open IndexedDB project storage.', { cause: error });
        }
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' });
            if (!database.objectStoreNames.contains('revisions')) {
                const store = database.createObjectStore('revisions', { keyPath: 'key' });
                store.createIndex('projectId', 'projectId', { unique: false });
            }
            if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
        };
        try {
            return new IndexedDbProjectAdapter(await openDatabasePromise(request, 'IndexedDB project upgrade is blocked by another tab.'));
        } catch (error) {
            throw new ProjectStorageError('Could not open IndexedDB project storage.', { cause: error });
        }
    }

    async _request(storeNames, mode, operation) {
        try {
            const transaction = this.database.transaction(storeNames, mode);
            const done = transactionPromise(transaction);
            const result = await operation(transaction);
            await done;
            return result;
        } catch (error) {
            const code = error?.name === 'QuotaExceededError' ? 'PROJECT_QUOTA_EXCEEDED' : 'PROJECT_STORAGE_ERROR';
            throw new ProjectStorageError('IndexedDB project operation failed.', { code, cause: error });
        }
    }

    async getProject(id) {
        return this._request(['projects'], 'readonly', (tx) => requestPromise(tx.objectStore('projects').get(id)));
    }
    async listProjects() {
        return this._request(['projects'], 'readonly', (tx) => requestPromise(tx.objectStore('projects').getAll()));
    }
    async putProjectWithRevision(project, revision) {
        return this._request(['projects', 'revisions'], 'readwrite', async (tx) => {
            const projects = tx.objectStore('projects');
            const revisions = tx.objectStore('revisions');
            await Promise.all([requestPromise(projects.put(project)), requestPromise(revisions.put(revision))]);
        });
    }
    async deleteProject(id) {
        const revisions = await this.listRevisions(id);
        return this._request(['projects', 'revisions'], 'readwrite', async (tx) => {
            const requests = [requestPromise(tx.objectStore('projects').delete(id))];
            for (const revision of revisions) requests.push(requestPromise(tx.objectStore('revisions').delete(revision.key)));
            await Promise.all(requests);
        });
    }
    async listRevisions(projectId) {
        const all = await this._request(['revisions'], 'readonly', (tx) => requestPromise(tx.objectStore('revisions').getAll()));
        return all.filter((item) => item.projectId === projectId);
    }
    async deleteRevision(key) {
        return this._request(['revisions'], 'readwrite', (tx) => requestPromise(tx.objectStore('revisions').delete(key)));
    }
    async getMeta(key) {
        const record = await this._request(['meta'], 'readonly', (tx) => requestPromise(tx.objectStore('meta').get(key)));
        return record?.value;
    }
    async setMeta(key, value) {
        return this._request(['meta'], 'readwrite', (tx) => requestPromise(tx.objectStore('meta').put({ key, value })));
    }
    close() { this.database.close(); }
}

function normalizeName(name, fallback = 'Untitled project') {
    const value = typeof name === 'string' ? name.trim().replace(/\s+/gu, ' ') : '';
    if (!value) return fallback;
    if (value.length > 100) throw new ProjectValidationError('Project name must be at most 100 characters.');
    return value;
}

function normalizeId(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new ProjectValidationError('Project id is invalid.');
    return id;
}

function defaultIdFactory() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function validateWithHook(validator, normalizer, project) {
    let candidate = cloneJsonValue(project);
    if (validator) {
        let result;
        try {
            result = await validator(cloneJsonValue(candidate));
        } catch (error) {
            if (error instanceof ProjectValidationError) throw error;
            throw new ProjectValidationError('Project validation failed.', { cause: error });
        }
        if (result === false) throw new ProjectValidationError('Project validation rejected the document.');
        if (result !== true && result !== undefined) candidate = cloneJsonValue(result);
    }
    try {
        return cloneJsonValue(await normalizer(candidate));
    } catch (error) {
        if (error instanceof ProjectValidationError) throw error;
        throw new ProjectValidationError('Project normalization failed.', { cause: error });
    }
}

function publicRecord(record) {
    if (!record) return null;
    return cloneRecord(record);
}

export class ProjectStore {
    constructor(adapter, {
        validateProject,
        normalizeProject = normalizeProjectDocument,
        now = () => new Date(),
        idFactory = defaultIdFactory,
        maxRevisions,
        autosaveDelayMs = 750,
        legacyStorage,
        legacyKey = LEGACY_PATTERN_KEY,
    } = {}) {
        if (!adapter) throw new ProjectStorageError('A project storage adapter is required.');
        if (validateProject !== undefined && typeof validateProject !== 'function') throw new TypeError('validateProject must be a function.');
        if (typeof normalizeProject !== 'function') throw new TypeError('normalizeProject must be a function.');
        const resolvedMaxRevisions = maxRevisions ?? (adapter.kind === 'localStorage' ? 1 : DEFAULT_MAX_REVISIONS);
        if (!Number.isInteger(resolvedMaxRevisions) || resolvedMaxRevisions < 1 || resolvedMaxRevisions > 500) throw new RangeError('maxRevisions is invalid.');
        this.adapter = adapter;
        this.storageKind = adapter.kind || 'custom';
        this.persistent = adapter.persistent !== false;
        this.validateProject = validateProject;
        this.normalizeProject = normalizeProject;
        this.now = now;
        this.idFactory = idFactory;
        this.maxRevisions = resolvedMaxRevisions;
        this.autosaveDelayMs = autosaveDelayMs;
        this.legacyStorage = legacyStorage;
        this.legacyKey = legacyKey;
        this.pendingAutosaves = new Map();
        this.migration = null;
    }

    _timestamp() {
        const value = this.now();
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) throw new ProjectStoreError('Clock returned an invalid timestamp.');
        return date.toISOString();
    }

    async saveProject(project, { id, name, reason = 'manual' } = {}) {
        const data = await validateWithHook(this.validateProject, this.normalizeProject, project);
        const projectId = normalizeId(id || this.idFactory());
        const existing = await this.adapter.getProject(projectId);
        const timestamp = this._timestamp();
        const revision = (existing?.revision || 0) + 1;
        const record = {
            id: projectId,
            name: normalizeName(name ?? existing?.name),
            revision,
            createdAt: existing?.createdAt || timestamp,
            updatedAt: timestamp,
            data,
        };
        const snapshot = {
            key: `${projectId}:${revision}`,
            projectId,
            revision,
            reason: normalizeName(reason, 'manual').slice(0, 40),
            createdAt: timestamp,
            name: record.name,
            data,
        };
        await this.adapter.putProjectWithRevision(cloneRecord(record), cloneRecord(snapshot));
        await this._pruneRevisions(projectId);
        return publicRecord(record);
    }

    async _pruneRevisions(projectId) {
        const revisions = await this.adapter.listRevisions(projectId);
        revisions.sort((a, b) => b.revision - a.revision);
        await Promise.all(revisions.slice(this.maxRevisions).map((revision) => this.adapter.deleteRevision(revision.key)));
    }

    async getProject(id) { return publicRecord(await this.adapter.getProject(normalizeId(id))); }

    async listProjects() {
        const projects = await this.adapter.listProjects();
        return projects
            .map(({ data: _data, ...metadata }) => cloneRecord(metadata))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async deleteProject(id) {
        const projectId = normalizeId(id);
        this.cancelAutosave(projectId);
        await this.adapter.deleteProject(projectId);
    }

    async renameProject(id, name) {
        const existing = await this.getProject(id);
        if (!existing) throw new ProjectStorageError('Project does not exist.', { code: 'PROJECT_NOT_FOUND' });
        return this.saveProject(existing.data, { id: existing.id, name: normalizeName(name), reason: 'rename' });
    }

    async listRevisions(id, { limit = this.maxRevisions } = {}) {
        const projectId = normalizeId(id);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Revision limit is invalid.');
        const revisions = await this.adapter.listRevisions(projectId);
        return revisions.sort((a, b) => b.revision - a.revision).slice(0, limit).map(publicRecord);
    }

    async getRevision(id, revisionNumber) {
        if (!Number.isInteger(revisionNumber) || revisionNumber < 1) throw new ProjectValidationError('Revision number is invalid.');
        const revisions = await this.adapter.listRevisions(normalizeId(id));
        return publicRecord(revisions.find((revision) => revision.revision === revisionNumber));
    }

    async restoreRevision(id, revisionNumber, { name } = {}) {
        const revision = await this.getRevision(id, revisionNumber);
        if (!revision) throw new ProjectStorageError('Project revision does not exist.', { code: 'REVISION_NOT_FOUND' });
        return this.saveProject(revision.data, { id, name: name ?? revision.name, reason: `restore-${revisionNumber}` });
    }

    autosaveProject(project, { id, name, debounceMs = this.autosaveDelayMs } = {}) {
        const projectId = normalizeId(id || this.idFactory());
        if (!Number.isFinite(debounceMs) || debounceMs < 0 || debounceMs > 60_000) throw new RangeError('Autosave delay is invalid.');
        const clonedProject = cloneJsonValue(project);
        let pending = this.pendingAutosaves.get(projectId);
        if (!pending) pending = { waiters: [] };
        if (pending.timer) clearTimeout(pending.timer);
        pending.project = clonedProject;
        pending.options = { id: projectId, name, reason: 'autosave' };
        const promise = new Promise((resolve, reject) => pending.waiters.push({ resolve, reject }));
        pending.timer = setTimeout(() => { void this._commitAutosave(projectId); }, debounceMs);
        this.pendingAutosaves.set(projectId, pending);
        return promise;
    }

    async _commitAutosave(projectId) {
        const pending = this.pendingAutosaves.get(projectId);
        if (!pending) return null;
        this.pendingAutosaves.delete(projectId);
        if (pending.timer) clearTimeout(pending.timer);
        try {
            const result = await this.saveProject(pending.project, pending.options);
            pending.waiters.forEach(({ resolve }) => resolve(result));
            return result;
        } catch (error) {
            pending.waiters.forEach(({ reject }) => reject(error));
            throw error;
        }
    }

    async flushAutosaves(id) {
        if (id !== undefined) return this._commitAutosave(normalizeId(id));
        return Promise.all([...this.pendingAutosaves.keys()].map((projectId) => this._commitAutosave(projectId)));
    }

    cancelAutosave(id, reason = new ProjectStoreError('Autosave was cancelled.', { code: 'AUTOSAVE_CANCELLED' })) {
        const projectId = normalizeId(id);
        const pending = this.pendingAutosaves.get(projectId);
        if (!pending) return false;
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingAutosaves.delete(projectId);
        pending.waiters.forEach(({ reject }) => reject(reason));
        return true;
    }

    async migrateLegacyPattern({ name = 'Migrated DM99 pattern', removeLegacy = false } = {}) {
        const metaKey = `migration:${this.legacyKey}`;
        const prior = await this.adapter.getMeta(metaKey);
        if (prior) return cloneRecord(prior);
        if (!this.legacyStorage || typeof this.legacyStorage.getItem !== 'function') return { status: 'unavailable' };
        let raw;
        try {
            raw = this.legacyStorage.getItem(this.legacyKey);
        } catch (error) {
            throw new ProjectStorageError('Could not read the legacy pattern.', { cause: error });
        }
        if (!raw) {
            const result = { status: 'not-found', checkedAt: this._timestamp() };
            await this.adapter.setMeta(metaKey, result);
            return result;
        }
        if (raw.length > MAX_PROJECT_JSON_BYTES) throw new ProjectValidationError('Legacy pattern exceeds the import size limit.');
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new ProjectValidationError('Legacy pattern is not valid JSON.', { cause: error });
        }
        const saved = await this.saveProject(parsed, { id: 'legacy-dm99-pattern', name, reason: 'legacy-migration' });
        const result = { status: 'migrated', projectId: saved.id, revision: saved.revision, migratedAt: this._timestamp() };
        await this.adapter.setMeta(metaKey, result);
        if (removeLegacy && typeof this.legacyStorage.removeItem === 'function') this.legacyStorage.removeItem(this.legacyKey);
        return cloneRecord(result);
    }

    async close({ flush = true } = {}) {
        if (flush) await this.flushAutosaves();
        else for (const id of [...this.pendingAutosaves.keys()]) this.cancelAutosave(id);
        if (typeof this.adapter.close === 'function') this.adapter.close();
    }
}

function safeGlobalStorage(name) {
    try {
        return globalThis[name];
    } catch {
        return undefined;
    }
}

export async function openProjectStore(options = {}) {
    let adapter = options.adapter;
    const legacyStorage = Object.hasOwn(options, 'localStorage')
        ? options.localStorage
        : safeGlobalStorage('localStorage');
    let fallbackError = null;

    if (!adapter) {
        const indexedDBFactory = Object.hasOwn(options, 'indexedDB')
            ? options.indexedDB
            : safeGlobalStorage('indexedDB');
        if (indexedDBFactory) {
            try {
                adapter = await IndexedDbProjectAdapter.open(indexedDBFactory, { dbName: options.dbName });
            } catch (error) {
                fallbackError = error;
                if (typeof options.onStorageError === 'function') options.onStorageError(error);
            }
        }
    }
    if (!adapter && legacyStorage) adapter = new LocalStorageProjectAdapter(legacyStorage, { storageKey: options.storageKey });
    if (!adapter) adapter = new MemoryProjectAdapter();

    const store = new ProjectStore(adapter, { ...options, legacyStorage });
    store.fallbackError = fallbackError;
    if (options.migrateLegacy !== false) store.migration = await store.migrateLegacyPattern(options.migrationOptions);
    return store;
}

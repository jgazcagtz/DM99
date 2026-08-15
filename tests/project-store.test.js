import assert from 'node:assert/strict';
import test from 'node:test';

import {
    LEGACY_PATTERN_KEY,
    LocalStorageProjectAdapter,
    MemoryProjectAdapter,
    ProjectStore,
    ProjectValidationError,
    normalizeProjectDocument,
    openProjectStore,
} from '../src/project-store.js';
import { INSTRUMENT_IDS, PROJECT_STATE_VERSION } from '../src/pattern-constants.js';
import { createDefaultProjectState } from '../src/project-state.js';
import { createLegacyV2Fixture, createProjectFixture } from './fixtures/project-fixture.js';

class FakeStorage {
    constructor(entries = {}) {
        this.values = new Map(Object.entries(entries));
    }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

test('canonical normalization migrates v2 and preserves the complete v3 state contract', () => {
    const migrated = normalizeProjectDocument(createLegacyV2Fixture());
    assert.equal(migrated.version, PROJECT_STATE_VERSION);
    assert.equal(migrated.sequenceLength, 32);
    assert.deepEqual(Object.keys(migrated.sequences), INSTRUMENT_IDS);
    assert.equal(migrated.sequences.kick[0].velocity, 1);
    assert.equal(migrated.sequences.kick[0].probability, 1);
    assert.equal(migrated.sequences.kick[0].ratchet, 1);
    assert.equal(migrated.patterns.A.kick[0].active, true);
    assert.ok(migrated.trackSettings.kick);
    assert.ok(migrated.effects.masterEq);
    assert.ok(migrated.generator.seed);

    const fixture = createProjectFixture();
    const normalized = normalizeProjectDocument(fixture);
    assert.equal(normalized.patterns.A.kick[0].velocity, 0.8);
    assert.equal(normalized.patterns.A.kick[0].accent, true);
    assert.equal(normalized.patterns.A.bass1[2].ratchet, 3);
    assert.equal(normalized.patterns.A.bass1[2].slide, true);
    assert.equal(normalized.patterns.A.synth[8].nudgeMs, -12);
    assert.equal(normalizeProjectDocument(createDefaultProjectState({ sequenceLength: 64 })).sequenceLength, 64);
});

test('project store keeps multiple named projects, defensive copies, and bounded revisions', async () => {
    let tick = 0;
    const store = new ProjectStore(new MemoryProjectAdapter(), {
        maxRevisions: 2,
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    });
    const firstInput = createProjectFixture();
    await store.saveProject(firstInput, { id: 'alpha', name: 'Alpha' });
    firstInput.patterns.A.kick[0].velocity = 0.01;

    const stored = await store.getProject('alpha');
    assert.equal(stored.data.patterns.A.kick[0].velocity, 0.8);
    stored.data.patterns.A.kick[0].velocity = 0.02;
    assert.equal((await store.getProject('alpha')).data.patterns.A.kick[0].velocity, 0.8);

    const second = createProjectFixture();
    second.projectName = 'Beta State';
    await store.saveProject(second, { id: 'beta', name: 'Beta' });
    assert.equal((await store.listProjects()).length, 2);

    second.tempo = 140;
    await store.saveProject(second, { id: 'alpha', name: 'Alpha' });
    second.tempo = 150;
    await store.saveProject(second, { id: 'alpha', name: 'Alpha' });
    const revisions = await store.listRevisions('alpha');
    assert.deepEqual(revisions.map((revision) => revision.revision), [3, 2]);
    assert.equal((await store.getRevision('alpha', 1)), null);
});

test('validation hook runs on a defensive clone before canonical normalization', async () => {
    const fixture = createProjectFixture();
    const store = new ProjectStore(new MemoryProjectAdapter(), {
        validateProject(project) {
            project.projectName = 'Validator mutation';
            if (project.generator.seed === 'reject') return false;
            return true;
        },
    });
    await store.saveProject(fixture, { id: 'safe', name: 'Safe' });
    assert.equal(fixture.projectName, 'Fixture Groove');
    assert.equal((await store.getProject('safe')).data.projectName, 'Fixture Groove');

    fixture.generator.seed = 'reject';
    await assert.rejects(
        store.saveProject(fixture, { id: 'rejected', name: 'Rejected' }),
        ProjectValidationError,
    );
});

test('debounced autosave coalesces callers and saves the latest cloned state', async () => {
    const store = new ProjectStore(new MemoryProjectAdapter(), { autosaveDelayMs: 10 });
    const first = createProjectFixture();
    const second = createProjectFixture();
    first.tempo = 101;
    second.tempo = 155;
    const firstPromise = store.autosaveProject(first, { id: 'auto', name: 'Autosave' });
    const secondPromise = store.autosaveProject(second, { id: 'auto', name: 'Autosave' });
    second.tempo = 199;
    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(firstResult.revision, 1);
    assert.equal(secondResult.revision, 1);
    assert.equal((await store.getProject('auto')).data.tempo, 155);
});

test('legacy dm99-pattern migration is idempotent and does not delete source by default', async () => {
    const legacyJson = JSON.stringify(createLegacyV2Fixture());
    const localStorage = new FakeStorage({ [LEGACY_PATTERN_KEY]: legacyJson });
    const store = await openProjectStore({
        adapter: new MemoryProjectAdapter(),
        localStorage,
    });
    assert.equal(store.migration.status, 'migrated');
    const saved = await store.getProject('legacy-dm99-pattern');
    assert.equal(saved.data.version, PROJECT_STATE_VERSION);
    assert.equal(saved.data.tempo, 128);
    assert.equal(localStorage.getItem(LEGACY_PATTERN_KEY), legacyJson);
    assert.deepEqual(await store.migrateLegacyPattern(), store.migration);
});

test('openProjectStore falls back from failed IndexedDB to localStorage', async () => {
    const errors = [];
    const localStorage = new FakeStorage();
    const store = await openProjectStore({
        indexedDB: { open() { throw new Error('blocked'); } },
        localStorage,
        migrateLegacy: false,
        onStorageError(error) { errors.push(error); },
    });
    assert.equal(store.storageKind, 'localStorage');
    assert.equal(store.persistent, true);
    assert.ok(store.fallbackError);
    assert.equal(errors.length, 1);

    await store.saveProject(createProjectFixture(), { id: 'fallback', name: 'Fallback' });
    const reopened = new ProjectStore(new LocalStorageProjectAdapter(localStorage));
    assert.equal((await reopened.getProject('fallback')).name, 'Fallback');
});

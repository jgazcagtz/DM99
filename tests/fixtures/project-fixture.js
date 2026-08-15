import { createDefaultProjectState } from '../../src/project-state.js';

export function createProjectFixture() {
    const project = createDefaultProjectState();
    project.projectName = 'Fixture Groove';
    project.tempo = 132;
    project.swing = 0;

    Object.assign(project.patterns.A.kick[0], {
        active: true,
        velocity: 0.8,
        ratchet: 2,
        accent: true,
    });
    Object.assign(project.patterns.A.snare[4], {
        active: true,
        velocity: 0.65,
    });
    Object.assign(project.patterns.A.bass1[2], {
        active: true,
        pitch: 7,
        velocity: 0.5,
        ratchet: 3,
        slide: true,
    });
    Object.assign(project.patterns.A.synth[8], {
        active: true,
        pitch: 12,
        velocity: 1,
        probability: 0.75,
        nudgeMs: -12,
    });
    project.sequences = structuredClone(project.patterns.A);
    return project;
}

export function createLegacyV2Fixture() {
    const steps = Array.from({ length: 32 }, (_, index) => ({
        active: index % 4 === 0,
        pitch: 0,
        scale: 'minor',
    }));
    return {
        version: 2,
        sequences: { kick: steps },
        tempo: 128,
        swing: 17,
        volumes: { kick: 0.75 },
        muted: { kick: false },
        adsr: { kick: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.2 } },
    };
}

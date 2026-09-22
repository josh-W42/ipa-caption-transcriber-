import { describe, it, expect } from 'vitest';
import {
  INITIAL_STAGES, TOTAL_MEGABYTES, downloadedMegabytes,
  captionsReady, isDownloading, allSettled, type LoadStage,
} from './stages';

const set = (id: string, patch: Partial<LoadStage>): LoadStage[] =>
  INITIAL_STAGES.map((s) => (s.id === id ? { ...s, ...patch } : { ...s }));

describe('download accounting', () => {
  it('totals the advertised download', () => {
    // ~315MB. The aggregate is the figure worth showing; percent-of-current-file is not.
    expect(TOTAL_MEGABYTES).toBeGreaterThan(300);
    expect(TOTAL_MEGABYTES).toBeLessThan(330);
  });

  it('counts nothing before anything starts', () => {
    expect(downloadedMegabytes(INITIAL_STAGES)).toBe(0);
  });

  it('counts partial progress on the active stage', () => {
    const stages = set('live', { status: 'loading', progress: 50 });
    expect(downloadedMegabytes(stages)).toBeCloseTo(20.5, 1);
  });

  it('counts a cached stage as fully downloaded', () => {
    expect(downloadedMegabytes(set('live', { status: 'cached' }))).toBe(41);
  });

  it('does not count a failed stage', () => {
    expect(downloadedMegabytes(set('live', { status: 'failed' }))).toBe(0);
  });
});

describe('captionsReady', () => {
  it('is true once the small model lands, long before everything else', () => {
    // The whole point of staging: the app is usable at 41MB, not 315MB.
    expect(captionsReady(set('live', { status: 'ready' }))).toBe(true);
  });

  it('is false while the small model is still loading', () => {
    expect(captionsReady(set('live', { status: 'loading', progress: 90 }))).toBe(false);
  });

  it('is true when the small model was cached', () => {
    expect(captionsReady(set('live', { status: 'cached' }))).toBe(true);
  });
});

describe('isDownloading', () => {
  it('is false before anything starts', () => {
    expect(isDownloading(INITIAL_STAGES)).toBe(false);
  });

  it('is true mid-download', () => {
    expect(isDownloading(set('phoneme', { status: 'loading', progress: 40 }))).toBe(true);
  });

  it('is false for a returning visitor with everything cached', () => {
    // No progress events fire when a model comes from Cache Storage, so a bar would
    // imply a wait that is not happening.
    const cached = INITIAL_STAGES.map((s) => ({ ...s, status: 'cached' as const }));
    expect(isDownloading(cached)).toBe(false);
  });
});

describe('allSettled', () => {
  it('is false while work remains', () => {
    expect(allSettled(INITIAL_STAGES)).toBe(false);
  });

  it('treats a failure as settled', () => {
    // A failed optional model must not leave the UI waiting forever.
    const done = INITIAL_STAGES.map((s) =>
      s.id === 'phoneme' ? { ...s, status: 'failed' as const } : { ...s, status: 'ready' as const },
    );
    expect(allSettled(done)).toBe(true);
  });
});

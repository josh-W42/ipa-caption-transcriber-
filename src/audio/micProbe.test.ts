import { describe, it, expect } from 'vitest';
import { verdict, type ProbeResult } from './micProbe';

const base: ProbeResult = {
  path: 'test',
  seconds: 8,
  expectedSeconds: 8,
  dropouts: 0,
  centroid: 800,
  speechRms: 0.1,
};

describe('probe verdict', () => {
  it('accepts a healthy recording', () => {
    expect(verdict(base).healthy).toBe(true);
  });

  it('catches zero-filled loss', () => {
    const v = verdict({ ...base, dropouts: 0.3 });
    expect(v.healthy).toBe(false);
    expect(v.reasons.join()).toMatch(/zero-filled/);
  });

  /**
   * The case that produced a wrong diagnosis: MediaRecorder returned 5.40s of an
   * 8s recording with 0% dropouts, and a dropout-only check called it clean. The
   * same ~30% of audio was lost, just as missing time rather than as zeros.
   */
  it('catches loss that appears as missing duration, not zeros', () => {
    const v = verdict({ ...base, seconds: 5.4, dropouts: 0 });
    expect(v.healthy).toBe(false);
    expect(v.reasons.join()).toMatch(/duration missing/);
  });

  it('catches a high-frequency spectrum even when timing is perfect', () => {
    const v = verdict({ ...base, centroid: 3695 });
    expect(v.healthy).toBe(false);
    expect(v.reasons.join()).toMatch(/centroid/);
  });

  it('reports every independent failure at once', () => {
    const v = verdict({ ...base, seconds: 5.4, dropouts: 0.3, centroid: 3695 });
    expect(v.reasons).toHaveLength(3);
  });
});

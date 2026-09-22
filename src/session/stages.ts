/**
 * Load stages, for a cold start that explains itself.
 *
 * Three models load in sequence and total roughly 315MB. A first-time visitor arrives
 * at a blank page and waits; whether they keep waiting depends entirely on whether the
 * page tells them what is happening and what already works.
 *
 * "43% of model 2 of 3" is meaningless. "68 MB of 315 MB — captions already work" is not.
 */

export type StageId = 'live' | 'lexicon' | 'refined' | 'phoneme';
export type StageStatus = 'pending' | 'loading' | 'ready' | 'failed' | 'cached';

export interface LoadStage {
  id: StageId;
  label: string;
  /** What becomes possible when this finishes. The reason to keep waiting. */
  unlocks: string;
  /** Approximate download, MB. Used for the aggregate figure. */
  megabytes: number;
  status: StageStatus;
  /** 0-100 for the current stage. */
  progress: number;
}

export const INITIAL_STAGES: LoadStage[] = [
  {
    id: 'live',
    label: 'Speech model (small)',
    unlocks: 'live captions',
    megabytes: 41,
    status: 'pending',
    progress: 0,
  },
  {
    id: 'lexicon',
    label: 'Pronunciation dictionary',
    unlocks: 'phonemic IPA',
    megabytes: 1,
    status: 'pending',
    progress: 0,
  },
  {
    id: 'refined',
    label: 'Speech model (larger)',
    unlocks: 'more accurate final transcript',
    megabytes: 77,
    status: 'pending',
    progress: 0,
  },
  {
    id: 'phoneme',
    label: 'Phoneme model',
    unlocks: 'phonetic IPA and all analysis',
    megabytes: 197,
    status: 'pending',
    progress: 0,
  },
];

export const TOTAL_MEGABYTES = INITIAL_STAGES.reduce((n, s) => n + s.megabytes, 0);

/** Megabytes accounted for so far, counting partial progress on the active stage. */
export function downloadedMegabytes(stages: LoadStage[]): number {
  return stages.reduce((n, s) => {
    if (s.status === 'ready' || s.status === 'cached') return n + s.megabytes;
    if (s.status === 'loading') return n + (s.megabytes * s.progress) / 100;
    return n;
  }, 0);
}

/** True once captions are possible, which is well before everything has loaded. */
export const captionsReady = (stages: LoadStage[]): boolean =>
  ['ready', 'cached'].includes(stages.find((s) => s.id === 'live')?.status ?? '');

/**
 * Whether to show download UI at all.
 *
 * A returning visitor has everything in Cache Storage and should see no progress bar —
 * showing one implies a wait that is not happening.
 */
export const isDownloading = (stages: LoadStage[]): boolean =>
  stages.some((s) => s.status === 'loading' && s.progress > 0 && s.progress < 100);

export const allSettled = (stages: LoadStage[]): boolean =>
  stages.every((s) => s.status === 'ready' || s.status === 'cached' || s.status === 'failed');

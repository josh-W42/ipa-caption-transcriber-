/**
 * Distinctive feature table for the English phones both tracks can produce.
 *
 * The aligner needs a notion of phonological *closeness*, not a boolean same/different.
 * Plain edit distance would score /t/ -> [ɾ] exactly as badly as /t/ -> [i], so a
 * flapped "butter" would look as divergent as gibberish, and M4's measurements would
 * be meaningless.
 *
 * Values are +1, -1, or 0 for "not applicable to this phone". Features undefined on
 * either side are skipped, so comparing a vowel with a consonant is not dominated by
 * features that cannot apply to both.
 *
 * Hand-authored. That is a real limitation — it encodes one analyst's judgements, not
 * a learned or corpus-derived metric — and it is stated in the README rather than
 * implied to be objective.
 */

export type FeatureValue = 1 | -1 | 0;

/**
 * Major class features get more weight than the rest.
 *
 * Without weighting, the many features that agree trivially between any two phones
 * (both non-nasal, both non-lateral, both non-strident...) drown out the handful that
 * actually separate a consonant from a vowel. Weighting the major class restores the
 * primary organising distinction of the system.
 */
const WEIGHTS: Record<string, number> = {
  syllabic: 3,
  consonantal: 3,
  sonorant: 2,
  continuant: 1.5,
};
const DEFAULT_WEIGHT = 1;

const FEATURES = [
  'syllabic', 'consonantal', 'sonorant', 'continuant', 'nasal', 'strident', 'lateral',
  'delayedRelease', 'voice', 'spreadGlottis', 'labial', 'round', 'coronal', 'anterior',
  'distributed', 'dorsal', 'high', 'low', 'back', 'tense', 'rhotic',
] as const;

type Feature = (typeof FEATURES)[number];
type Vector = Partial<Record<Feature, FeatureValue>>;

/** Shared defaults for obstruents, overridden per phone. */
const C = (v: Vector): Vector => ({
  syllabic: -1, consonantal: 1, sonorant: -1, continuant: -1, nasal: -1, strident: -1,
  lateral: -1, delayedRelease: -1, spreadGlottis: -1, labial: -1, round: -1,
  coronal: -1, dorsal: -1, rhotic: -1, ...v,
});

/** Shared defaults for vowels; place features do not apply. */
const V = (v: Vector): Vector => ({
  syllabic: 1, consonantal: -1, sonorant: 1, continuant: 1, nasal: -1, strident: -1,
  lateral: -1, delayedRelease: -1, voice: 1, spreadGlottis: -1, labial: -1,
  dorsal: -1, rhotic: -1, ...v,
});

const TABLE: Record<string, Vector> = {
  // ---- stops ----
  p: C({ voice: -1, labial: 1 }),
  b: C({ voice: 1, labial: 1 }),
  t: C({ voice: -1, coronal: 1, anterior: 1, distributed: -1 }),
  d: C({ voice: 1, coronal: 1, anterior: 1, distributed: -1 }),
  k: C({ voice: -1, dorsal: 1, high: 1, back: 1 }),
  ɡ: C({ voice: 1, dorsal: 1, high: 1, back: 1 }),
  // Glottal stop: no oral place, which is why it can stand in for /t/ so readily.
  ʔ: C({ voice: -1, coronal: -1, anterior: -1 }),

  // ---- flap ----
  // Sonorant and voiced but non-continuant: two features from /t/, one from /d/.
  // That closeness is what makes flapping register as a substitution.
  ɾ: C({ sonorant: 1, voice: 1, coronal: 1, anterior: 1, distributed: -1 }),

  // ---- affricates ----
  'tʃ': C({ voice: -1, coronal: 1, anterior: -1, distributed: 1, strident: 1, delayedRelease: 1 }),
  'dʒ': C({ voice: 1, coronal: 1, anterior: -1, distributed: 1, strident: 1, delayedRelease: 1 }),

  // ---- fricatives ----
  f: C({ continuant: 1, voice: -1, labial: 1, strident: 1 }),
  v: C({ continuant: 1, voice: 1, labial: 1, strident: 1 }),
  θ: C({ continuant: 1, voice: -1, coronal: 1, anterior: 1, distributed: 1 }),
  ð: C({ continuant: 1, voice: 1, coronal: 1, anterior: 1, distributed: 1 }),
  s: C({ continuant: 1, voice: -1, coronal: 1, anterior: 1, distributed: -1, strident: 1 }),
  z: C({ continuant: 1, voice: 1, coronal: 1, anterior: 1, distributed: -1, strident: 1 }),
  ʃ: C({ continuant: 1, voice: -1, coronal: 1, anterior: -1, distributed: 1, strident: 1 }),
  ʒ: C({ continuant: 1, voice: 1, coronal: 1, anterior: -1, distributed: 1, strident: 1 }),
  h: C({ consonantal: -1, continuant: 1, voice: -1, spreadGlottis: 1 }),

  // ---- nasals ----
  m: C({ sonorant: 1, nasal: 1, voice: 1, labial: 1 }),
  n: C({ sonorant: 1, nasal: 1, voice: 1, coronal: 1, anterior: 1, distributed: -1 }),
  ŋ: C({ sonorant: 1, nasal: 1, voice: 1, dorsal: 1, high: 1, back: 1 }),

  // ---- liquids and glides ----
  l: C({ sonorant: 1, continuant: 1, lateral: 1, voice: 1, coronal: 1, anterior: 1 }),
  ɹ: C({ sonorant: 1, continuant: 1, voice: 1, coronal: 1, anterior: -1, rhotic: 1 }),
  j: C({ consonantal: -1, sonorant: 1, continuant: 1, voice: 1, dorsal: 1, high: 1, back: -1 }),
  w: C({ consonantal: -1, sonorant: 1, continuant: 1, voice: 1, labial: 1, round: 1, dorsal: 1, high: 1, back: 1 }),

  // ---- vowels ----
  i: V({ high: 1, low: -1, back: -1, tense: 1, round: -1 }),
  ɪ: V({ high: 1, low: -1, back: -1, tense: -1, round: -1 }),
  e: V({ high: -1, low: -1, back: -1, tense: 1, round: -1 }),
  ɛ: V({ high: -1, low: -1, back: -1, tense: -1, round: -1 }),
  æ: V({ high: -1, low: 1, back: -1, tense: -1, round: -1 }),
  a: V({ high: -1, low: 1, back: -1, tense: -1, round: -1 }),
  // Central vowels leave `back` undefined rather than guessing a side.
  ə: V({ high: -1, low: -1, tense: -1, round: -1 }),
  ɜ: V({ high: -1, low: -1, tense: -1, round: -1 }),
  ʌ: V({ high: -1, low: -1, back: 1, tense: -1, round: -1 }),
  ɑ: V({ high: -1, low: 1, back: 1, tense: 1, round: -1 }),
  ɔ: V({ high: -1, low: -1, back: 1, tense: 1, round: 1 }),
  o: V({ high: -1, low: -1, back: 1, tense: 1, round: 1 }),
  ʊ: V({ high: 1, low: -1, back: 1, tense: -1, round: 1 }),
  u: V({ high: 1, low: -1, back: 1, tense: 1, round: 1 }),
  // Rhotic vowels: schwa and wedge plus an r-colour.
  ɚ: V({ high: -1, low: -1, tense: -1, round: -1, rhotic: 1 }),
  ɝ: V({ high: -1, low: -1, tense: -1, round: -1, rhotic: 1 }),

  // ---- diphthongs ----
  // Characterised by their nucleus; the offglide is captured only in `round`, which is
  // enough to keep them apart from each other and from the monophthongs.
  'aɪ': V({ high: -1, low: 1, back: -1, tense: 1, round: -1 }),
  'aʊ': V({ high: -1, low: 1, back: -1, tense: 1, round: 1 }),
  'ɔɪ': V({ high: -1, low: -1, back: 1, tense: 1, round: 1 }),
  'eɪ': V({ high: -1, low: -1, back: -1, tense: 1, round: -1 }),
  'oʊ': V({ high: -1, low: -1, back: 1, tense: 1, round: 1 }),
};

export const INVENTORY = Object.keys(TABLE);

export function hasPhone(phone: string): boolean {
  return phone in TABLE;
}

/**
 * Weighted, normalised distance between two phones, in [0, 1].
 *
 * Features undefined on either phone are skipped entirely, so the denominator
 * reflects only what the two actually have in common to compare.
 */
export function featureDistance(a: string, b: string): number {
  if (a === b) return 0;

  const va = TABLE[a];
  const vb = TABLE[b];
  if (!va) throw new Error(`no feature vector for phone: ${a}`);
  if (!vb) throw new Error(`no feature vector for phone: ${b}`);

  let differing = 0;
  let compared = 0;

  for (const f of FEATURES) {
    const x = va[f];
    const y = vb[f];
    if (x === undefined || y === undefined || x === 0 || y === 0) continue;

    const w = WEIGHTS[f] ?? DEFAULT_WEIGHT;
    compared += w;
    if (x !== y) differing += w;
  }

  // No overlapping defined features is treated as maximally distant rather than as
  // identical, which is the safer failure.
  return compared === 0 ? 1 : differing / compared;
}

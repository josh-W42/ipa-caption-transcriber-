/**
 * CMUdict's 39 ARPAbet phones mapped to General American IPA.
 *
 * Two symbols to be careful with: English /r/ is the approximant ɹ (U+0279), not the
 * trill r, and the velar stop is ɡ (U+0261), not Latin g. Both look nearly identical
 * in most fonts and both would be wrong.
 */
const MAP: Record<string, string> = {
  AA: 'ɑ',
  AE: 'æ',
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  EH: 'ɛ',
  EY: 'eɪ',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  IH: 'ɪ',
  IY: 'i',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  OW: 'oʊ',
  OY: 'ɔɪ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  UH: 'ʊ',
  UW: 'u',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

/**
 * Two phones depend on stress, and both differences are clearly audible.
 *
 * AH is ʌ when stressed but reduces to schwa when not — the single most common
 * reduction in English. ER behaves the same way. A table that ignored this would
 * transcribe "about" as /ʌbaʊt/ instead of /əbaʊt/, and every divergence M4 measures
 * against the phonemic track would inherit the error.
 */
const STRESS_DEPENDENT: Record<string, { stressed: string; reduced: string }> = {
  AH: { stressed: 'ʌ', reduced: 'ə' },
  ER: { stressed: 'ɝ', reduced: 'ɚ' },
};

export type Stress = 0 | 1 | 2 | null;

export interface Phone {
  arpa: string;
  ipa: string;
  /** 0 unstressed, 1 primary, 2 secondary. null means a consonant. */
  stress: Stress;
}

export function splitStress(symbol: string): { base: string; stress: Stress } {
  const m = /^([A-Z]+)([012])$/.exec(symbol);
  if (!m) return { base: symbol, stress: null };
  return { base: m[1], stress: Number(m[2]) as 0 | 1 | 2 };
}

export function arpaToPhones(symbols: string[]): Phone[] {
  return symbols.map((symbol) => {
    const { base, stress } = splitStress(symbol);

    const pair = STRESS_DEPENDENT[base];
    if (pair) {
      return { arpa: symbol, ipa: stress === 0 ? pair.reduced : pair.stressed, stress };
    }

    const ipa = MAP[base];
    if (!ipa) throw new Error(`unknown ARPAbet symbol: ${symbol}`);
    return { arpa: symbol, ipa, stress };
  });
}

export function arpaToIpa(symbols: string[]): string[] {
  return arpaToPhones(symbols).map((p) => p.ipa);
}

/** Vowels are exactly the phones that carry a stress digit in CMUdict. */
export const isVowel = (p: Phone): boolean => p.stress !== null;

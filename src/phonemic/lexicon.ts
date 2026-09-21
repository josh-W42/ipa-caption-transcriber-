import { arpaToPhones } from './arpabet';
import { transcribeWord } from './syllable';

/**
 * Normalise a transcript token for dictionary lookup.
 *
 * Whisper emits words with attached punctuation and sentence capitalisation, while
 * CMUdict headwords are bare and lowercase. Apostrophes and hyphens must survive
 * because CMUdict has real entries for "don't", "'cause" and "well-known" — stripping
 * them would turn known words into false out-of-vocabulary reports.
 */
export function normaliseWord(token: string): string {
  const lowered = token.toLowerCase();
  // Strip anything that is not a letter, digit, apostrophe or hyphen from the ends.
  const trimmed = lowered.replace(/^[^\p{L}\p{N}']+/gu, '').replace(/[^\p{L}\p{N}']+$/gu, '');
  // A token of pure punctuation normalises to nothing.
  return /[\p{L}\p{N}]/u.test(trimmed) ? trimmed : '';
}

export interface WordTranscription {
  /** The token exactly as it appeared, punctuation and all. */
  word: string;
  found: boolean;
  /** Phonemic IPA without slashes; the UI adds those. Null when not found. */
  ipa: string | null;
}

export class Lexicon {
  private entries: Map<string, string>;
  /** Transcription cache — caption windows repeat the same words constantly. */
  private cache = new Map<string, string>();

  private constructor(entries: Map<string, string>) {
    this.entries = entries;
  }

  static fromText(text: string): Lexicon {
    const entries = new Map<string, string>();
    for (const line of text.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 1) continue;
      entries.set(line.slice(0, tab), line.slice(tab + 1));
    }
    return new Lexicon(entries);
  }

  static async load(
    url: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Lexicon> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`lexicon not found at ${url} (HTTP ${res.status})`);

    // Report progress when the server tells us the size; the asset is ~0.87MB gzipped
    // and this runs behind the far larger model download, so it is rarely visible.
    const total = Number(res.headers.get('content-length') ?? 0);
    if (onProgress && total > 0 && res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress(loaded, total);
      }
      const merged = new Uint8Array(loaded);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return Lexicon.fromText(new TextDecoder().decode(merged));
    }

    return Lexicon.fromText(await res.text());
  }

  get size(): number {
    return this.entries.size;
  }

  lookup(token: string): WordTranscription {
    const key = normaliseWord(token);
    if (!key) return { word: token, found: false, ipa: null };

    const cached = this.cache.get(key);
    if (cached !== undefined) return { word: token, found: true, ipa: cached };

    const arpa = this.entries.get(key);
    // Out of vocabulary: reported, never synthesised. A plausible-looking guess would
    // be indistinguishable from a real entry and would poison M4's comparisons.
    if (!arpa) return { word: token, found: false, ipa: null };

    const ipa = transcribeWord(arpaToPhones(arpa.split(' ')));
    this.cache.set(key, ipa);
    return { word: token, found: true, ipa };
  }

  /** Transcribe a whole transcript, preserving token order and original spelling. */
  transcribe(text: string): WordTranscription[] {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    return tokens.map((t) => this.lookup(t));
  }
}

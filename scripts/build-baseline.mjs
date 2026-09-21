/**
 * Derive an English phone-frequency baseline for comparison against a speaker.
 *
 * Source is hermitdave/FrequencyWords en_50k (MIT), which carries real token counts
 * and is derived from OpenSubtitles — SPOKEN language. That choice matters: written
 * English has a measurably different phone distribution, so a written-corpus baseline
 * would build a mismatch into every comparison the app makes.
 *
 * Reads the SHIPPED lexicon rather than re-parsing CMUdict, so the baseline cannot
 * drift from the pronunciations the app actually uses.
 *
 * Input   scripts/en_50k.txt   (gitignored; fetch per the M4 plan)
 *         public/lexicon.txt   (built by build-lexicon.mjs)
 * Output  public/phone-baseline.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FREQ = 'scripts/en_50k.txt';
const LEX = 'public/lexicon.txt';
const OUT = 'public/phone-baseline.json';

// Must match src/phonemic/arpabet.ts exactly.
const MAP = {
  AA: 'ɑ', AE: 'æ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', B: 'b', CH: 'tʃ', D: 'd', DH: 'ð',
  EH: 'ɛ', EY: 'eɪ', F: 'f', G: 'ɡ', HH: 'h', IH: 'ɪ', IY: 'i', JH: 'dʒ', K: 'k',
  L: 'l', M: 'm', N: 'n', NG: 'ŋ', OW: 'oʊ', OY: 'ɔɪ', P: 'p', R: 'ɹ', S: 's',
  SH: 'ʃ', T: 't', TH: 'θ', UH: 'ʊ', UW: 'u', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
// Stress-dependent, as in arpabet.ts: [stressed, reduced].
const STRESS_DEPENDENT = { AH: ['ʌ', 'ə'], ER: ['ɝ', 'ɚ'] };

const lexicon = new Map();
for (const line of readFileSync(LEX, 'utf8').split('\n')) {
  const tab = line.indexOf('\t');
  if (tab > 0) lexicon.set(line.slice(0, tab), line.slice(tab + 1));
}

const counts = new Map();
let foundTypes = 0;
let missingTypes = 0;
let foundTokens = 0;
let missingTokens = 0;

for (const line of readFileSync(FREQ, 'utf8').split('\n')) {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 2) continue;

  const word = parts[0].toLowerCase();
  const n = Number(parts[1]);
  if (!Number.isFinite(n)) continue;

  const arpa = lexicon.get(word);
  if (!arpa) {
    missingTypes++;
    missingTokens += n;
    continue;
  }
  foundTypes++;
  foundTokens += n;

  for (const symbol of arpa.split(' ')) {
    const m = /^([A-Z]+)([012])$/.exec(symbol);
    const base = m ? m[1] : symbol;
    const stress = m ? Number(m[2]) : null;

    const pair = STRESS_DEPENDENT[base];
    const ipa = pair ? (stress === 0 ? pair[1] : pair[0]) : MAP[base];
    if (!ipa) continue;

    counts.set(ipa, (counts.get(ipa) ?? 0) + n);
  }
}

const totalPhones = [...counts.values()].reduce((a, b) => a + b, 0);
const coverage = foundTokens / (foundTokens + missingTokens);

// Guard: if the lexicon and the frequency list ever diverge, the baseline stops being
// representative and should not be shipped silently.
if (coverage < 0.9) {
  console.error(`token coverage ${(coverage * 100).toFixed(2)}% is below 90% — refusing to write`);
  process.exit(1);
}

const proportions = Object.fromEntries(
  [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p, c]) => [p, c / totalPhones]),
);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: 'hermitdave/FrequencyWords en_50k (MIT), derived from OpenSubtitles',
      note: 'Conversational English. A reference, not a standard.',
      tokenCoverage: Number(coverage.toFixed(4)),
      wordTypesUsed: foundTypes,
      wordTypesMissing: missingTypes,
      totalPhoneTokens: totalPhones,
      proportions,
    },
    null,
    1,
  ),
  'utf8',
);

console.log(`word types    ${foundTypes.toLocaleString()} found, ${missingTypes.toLocaleString()} missing`);
console.log(`token coverage ${(coverage * 100).toFixed(2)}%`);
console.log(`phones        ${counts.size} over ${totalPhones.toLocaleString()} tokens`);
console.log('top 8:');
for (const [p, v] of Object.entries(proportions).slice(0, 8)) {
  console.log(`  ${p.padEnd(3)} ${(v * 100).toFixed(2)}%`);
}

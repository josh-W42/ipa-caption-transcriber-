/**
 * Convert CMUdict into the compact lexicon the app ships.
 *
 * Output stays in ARPAbet rather than pre-converted IPA: the mapping is pure and
 * tested in src/phonemic/arpabet.ts, the asset stays inspectable, and ASCII compresses
 * considerably better than multi-byte IPA.
 *
 * Input  scripts/cmudict.dict  (gitignored; fetch with the curl in the M2 plan)
 * Output public/lexicon.txt    word<TAB>PHONE PHONE PHONE
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const SRC = 'scripts/cmudict.dict';
const OUT = 'public/lexicon.txt';

const lines = readFileSync(SRC, 'utf8').split('\n');

const out = [];
let skippedComments = 0;
let skippedAlternates = 0;
let skippedMalformed = 0;

for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith(';;;')) {
    skippedComments++;
    continue;
  }

  // "word  PH PH PH" — CMUdict separates the headword with a space.
  const sp = line.indexOf(' ');
  if (sp < 1) {
    skippedMalformed++;
    continue;
  }

  const word = line.slice(0, sp).toLowerCase();
  const phones = line.slice(sp + 1).trim();
  if (!phones) {
    skippedMalformed++;
    continue;
  }

  // Alternate pronunciations appear as word(2), word(3). Real, but M2 shows one
  // canonical form; alternates are M4 material.
  if (/\(\d+\)$/.test(word)) {
    skippedAlternates++;
    continue;
  }

  out.push(`${word}\t${phones}`);
}

const text = out.join('\n');
writeFileSync(OUT, text, 'utf8');

const raw = statSync(OUT).size;
const gz = gzipSync(Buffer.from(text, 'utf8')).length;

console.log(`entries written     ${out.length.toLocaleString()}`);
console.log(`skipped comments    ${skippedComments}`);
console.log(`skipped alternates  ${skippedAlternates.toLocaleString()}`);
console.log(`skipped malformed   ${skippedMalformed}`);
console.log(`raw size            ${(raw / 1e6).toFixed(2)} MB`);
console.log(`gzipped size        ${(gz / 1e6).toFixed(2)} MB   <- what Firebase serves`);

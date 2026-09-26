// One-way fingerprints of retired words from the previous release.
// Original spellings stay in build/test tooling and are never downloaded.
const retiredWords = new Set([
  "8:f3a0efd5",
  "5:5ee0616a",
  "6:c0c58981",
  "5:8de0ab67",
  "5:afbc812b",
  "12:191ff717",
  "6:2a9b2fb0",
  "8:71e20057",
  "7:33fe2087",
  "5:88e0a388",
  "10:5a06fdf5",
]);

function fingerprint(word: string): string {
  let hash = 2166136261;
  for (const char of word.toLowerCase())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return word.length + ":" + (hash >>> 0).toString(16);
}

// Migrate only local saved prose; gameplay state and timing are preserved.
export function refreshSavedCopy(text: string): string {
  return text.replace(/\p{L}+/gu, (word) =>
    retiredWords.has(fingerprint(word)) ? "—" : word,
  );
}

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

// Exact legacy sentences identify placeholder positions, preserving punctuation dashes.
const retiredDashPositions: Record<string, readonly number[]> = {
  "147:a9f42156": [137],
  "28:4939567": [26],
  "29:b62e518f": [27],
  "28:f9e8a8fc": [26],
  "34:6e682601": [32],
  "56:bebdabb3": [8],
  "85:a0428ba3": [83],
  "102:4b2b241b": [55],
  "36:61f238b0": [15],
  "28:d5cbc56c": [26],
  "57:bfe5c17a": [19],
  "61:58bdb705": [59],
  "60:fa9f5ace": [58],
  "177:eae1b86": [175],
  "79:fc96452f": [23],
  "59:aa77cddc": [35],
  "48:a521e3c2": [27],
  "64:55803bee": [35],
  "81:ba5ad241": [79],
  "90:32be1e93": [0],
  "65:111b9ff2": [53],
  "6:5d3585c8": [0],
  "4:997d8e03": [3],
  "10:3efb5b54": [0],
  "76:d7d23f62": [14],
  "81:82a9592a": [36],
};

function fingerprint(word: string): string {
  let hash = 2166136261;
  for (const char of word.toLowerCase())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return word.length + ":" + (hash >>> 0).toString(16);
}

// Migrate only local saved prose; gameplay state and timing are preserved.
export function refreshSavedCopy(text: string): string {
  const positions = retiredDashPositions[fingerprint(text)];
  const refreshed = positions?.every((index) => text[index] === "—")
    ? positions.reduceRight(
        (line, index) => line.slice(0, index) + "[ПИП]" + line.slice(index + 1),
        text,
      )
    : text;
  return refreshed.replace(/\p{L}+/gu, (word) =>
    retiredWords.has(fingerprint(word)) ? "[ПИП]" : word,
  );
}

const { readFile, writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const { ocrPgsSupToSrt } = require("../dist-electron/main/pgsOcrService.js");

async function main() {
  const [supArgument, referenceArgument, outputArgument] = process.argv.slice(2);
  if (!supArgument || !referenceArgument) {
    throw new Error("Usage: npm run benchmark:pgs -- <track.sup> <reference.srt> [ocr-output.srt]");
  }

  const supPath = resolve(supArgument);
  const referencePath = resolve(referenceArgument);
  const outputPath = resolve(outputArgument ?? `${supPath}.ocr.srt`);
  const startedAt = Date.now();
  const ocrSrt = process.env.PGS_BENCHMARK_REUSE === "1"
    ? await readFile(outputPath, "utf8")
    : await ocrPgsSupToSrt(supPath, {
        language: "eng",
        onProgress(progress) {
          if (progress.completedImages === progress.totalImages || progress.completedImages % 25 === 0) {
            process.stderr.write(
              `OCR ${progress.completedImages}/${progress.totalImages}; readable ${progress.readableCues}\n`
            );
          }
        }
      });
  if (process.env.PGS_BENCHMARK_REUSE !== "1") {
    await writeFile(outputPath, ocrSrt, "utf8");
  }

  const referenceSrt = await readFile(referencePath, "utf8");
  const report = compare(parseSrt(referenceSrt), parseSrt(ocrSrt));
  console.log(JSON.stringify({
    ...report,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
    outputPath
  }, null, 2));
}

function compare(reference, actual) {
  const potentialPairs = [];
  for (let referenceIndex = 0; referenceIndex < reference.length; referenceIndex += 1) {
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
      const overlap = Math.min(reference[referenceIndex].endMs, actual[actualIndex].endMs) -
        Math.max(reference[referenceIndex].startMs, actual[actualIndex].startMs);
      const midpointDistance = Math.abs(midpoint(reference[referenceIndex]) - midpoint(actual[actualIndex]));
      if (overlap > 0 || midpointDistance <= 1000) {
        potentialPairs.push({ referenceIndex, actualIndex, overlap, midpointDistance });
      }
    }
  }
  potentialPairs.sort((left, right) => right.overlap - left.overlap || left.midpointDistance - right.midpointDistance);

  const matchedReferences = new Set();
  const matchedActual = new Set();
  const pairs = [];
  for (const pair of potentialPairs) {
    if (!matchedReferences.has(pair.referenceIndex) && !matchedActual.has(pair.actualIndex)) {
      matchedReferences.add(pair.referenceIndex);
      matchedActual.add(pair.actualIndex);
      pairs.push(pair);
    }
  }

  let characterEdits = 0;
  let referenceCharacters = 0;
  let wordEdits = 0;
  let referenceWords = 0;
  let exactCues = 0;
  let caseInsensitiveCharacterEdits = 0;
  let caseInsensitiveExactCues = 0;
  const cueErrors = [];
  for (let referenceIndex = 0; referenceIndex < reference.length; referenceIndex += 1) {
    const pair = pairs.find((candidate) => candidate.referenceIndex === referenceIndex);
    const expected = normalizeText(reference[referenceIndex].text);
    const observed = pair ? normalizeText(actual[pair.actualIndex].text) : "";
    const cueCharacterEdits = levenshtein([...expected], [...observed]);
    characterEdits += cueCharacterEdits;
    referenceCharacters += [...expected].length;
    caseInsensitiveCharacterEdits += levenshtein(
      [...expected.toLocaleLowerCase()],
      [...observed.toLocaleLowerCase()]
    );
    const expectedWords = tokenizeWords(expected);
    const observedWords = tokenizeWords(observed);
    const cueWordEdits = levenshtein(expectedWords, observedWords);
    wordEdits += cueWordEdits;
    referenceWords += expectedWords.length;
    if (expected === observed) {
      exactCues += 1;
    } else {
      cueErrors.push({
        referenceCue: referenceIndex + 1,
        actualCue: pair ? pair.actualIndex + 1 : null,
        startMs: reference[referenceIndex].startMs,
        characterEdits: cueCharacterEdits,
        wordEdits: cueWordEdits,
        expected,
        observed
      });
    }
    if (expected.toLocaleLowerCase() === observed.toLocaleLowerCase()) {
      caseInsensitiveExactCues += 1;
    }
  }

  return {
    referenceCues: reference.length,
    actualCues: actual.length,
    matchedCues: pairs.length,
    missingCues: reference.length - pairs.length,
    extraCues: actual.length - pairs.length,
    cueRecallPercent: percent(pairs.length, reference.length),
    exactCuePercent: percent(exactCues, reference.length),
    characterAccuracyPercent: 100 - percent(characterEdits, referenceCharacters),
    caseInsensitiveExactCuePercent: percent(caseInsensitiveExactCues, reference.length),
    caseInsensitiveCharacterAccuracyPercent: 100 - percent(caseInsensitiveCharacterEdits, referenceCharacters),
    wordAccuracyPercent: 100 - percent(wordEdits, referenceWords),
    characterEdits,
    caseInsensitiveCharacterEdits,
    referenceCharacters,
    wordEdits,
    referenceWords,
    worstCues: cueErrors
      .sort((left, right) => right.characterEdits - left.characterEdits || right.wordEdits - left.wordEdits)
      .slice(0, 25)
  };
}

function parseSrt(input) {
  return input.replace(/^\uFEFF/, "").trim().split(/\r?\n\r?\n+/).flatMap((block) => {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) return [];
    const match = lines[timingIndex].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) return [];
    return [{
      startMs: timestamp(match.slice(1, 5)),
      endMs: timestamp(match.slice(5, 9)),
      text: lines.slice(timingIndex + 1).join("\n")
    }];
  });
}

function timestamp(parts) {
  return ((Number(parts[0]) * 60 + Number(parts[1])) * 60 + Number(parts[2])) * 1000 + Number(parts[3]);
}

function midpoint(cue) {
  return (cue.startMs + cue.endMs) / 2;
}

function normalizeText(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeWords(text) {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) ?? [];
}

function levenshtein(expected, actual) {
  let previous = Array.from({ length: actual.length + 1 }, (_value, index) => index);
  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    const current = [expectedIndex + 1];
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
      current.push(Math.min(
        current[actualIndex] + 1,
        previous[actualIndex + 1] + 1,
        previous[actualIndex] + (expected[expectedIndex] === actual[actualIndex] ? 0 : 1)
      ));
    }
    previous = current;
  }
  return previous[actual.length];
}

function percent(numerator, denominator) {
  return denominator === 0 ? 100 : Math.round((numerator / denominator) * 100000) / 1000;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

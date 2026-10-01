const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { dirname } = require("node:path");

async function main() {
  const [exchangePath, timedSubtitlePath, outputPath] = process.argv.slice(2);
  if (!exchangePath || !timedSubtitlePath || !outputPath) {
    throw new Error(
      "Usage: node scripts/reconstruct-source-from-exchanges.cjs <exchanges.jsonl> <timed.srt> <output.srt>"
    );
  }

  const sourceById = new Map();
  const exchangeLines = (await readFile(exchangePath, "utf8")).split(/\r?\n/).filter(Boolean);
  for (const line of exchangeLines) {
    const exchange = JSON.parse(line);
    for (const cue of exchange.request?.targetLines ?? []) {
      sourceById.set(Number(cue.id), String(cue.text));
    }
  }

  const timedBlocks = (await readFile(timedSubtitlePath, "utf8"))
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n\s*\r?\n/);
  const reconstructed = timedBlocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const id = Number(lines[0]);
    const timing = lines[1];
    const source = sourceById.get(id);
    if (!Number.isInteger(id) || !timing?.includes(" --> ") || source === undefined) {
      throw new Error(`Cannot reconstruct subtitle block beginning with: ${lines[0] ?? "<empty>"}`);
    }
    return `${id}\r\n${timing}\r\n${source}`;
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `\uFEFF${reconstructed.join("\r\n\r\n")}\r\n`, "utf8");
  process.stdout.write(`Reconstructed ${reconstructed.length} source cues at ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { PNG } = require("pngjs");
const { parsePgsSup } = require("../dist-electron/core/subtitle/PgsParser.js");

const [supArgument, outputArgument] = process.argv.slice(2);
if (!supArgument || !outputArgument) {
  throw new Error("Usage: node scripts/export-pgs-cues.cjs <track.sup> <output-directory>");
}

const outputDirectory = resolve(outputArgument);
mkdirSync(outputDirectory, { recursive: true });
const cues = parsePgsSup(readFileSync(resolve(supArgument)));
for (const cue of cues) {
  const png = new PNG({ width: cue.width, height: cue.height });
  for (let offset = 0; offset < cue.rgba.length; offset += 4) {
    const alpha = cue.rgba[offset + 3] / 255;
    png.data[offset] = Math.round(cue.rgba[offset] * alpha);
    png.data[offset + 1] = Math.round(cue.rgba[offset + 1] * alpha);
    png.data[offset + 2] = Math.round(cue.rgba[offset + 2] * alpha);
    png.data[offset + 3] = 255;
  }
  const name = `cue-${String(cue.id).padStart(4, "0")}-${cue.startMs}.png`;
  writeFileSync(join(outputDirectory, name), PNG.sync.write(png));
}
console.log(`Exported ${cues.length} cue images to ${outputDirectory}`);

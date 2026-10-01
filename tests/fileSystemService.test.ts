import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureOutputDirectory, writeSrtSafely } from "../src/main/fileSystemService";

const validSrt = `1
00:00:01,000 --> 00:00:02,000
Здравей.
`;

describe("safe SRT output writes", () => {
  it("writes through a validated temporary file and versions conflicts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subtitle-writer-"));
    const outputPath = join(dir, "episode.bg.srt");
    await writeFile(outputPath, validSrt, "utf8");

    const saved = await writeSrtSafely(outputPath, validSrt, "versioned");

    expect(saved.endsWith("episode.bg.2.srt")).toBe(true);
    expect(await readFile(saved, "utf8")).toContain("Здравей.");
  });

  it("rejects invalid generated SRT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subtitle-writer-"));
    await expect(writeSrtSafely(join(dir, "bad.bg.srt"), "bad", "versioned")).rejects.toThrow(/failed validation/i);
  });

  it("does not try to create an existing drive root output directory", async () => {
    await expect(ensureOutputDirectory(parse(tmpdir()).root)).resolves.toBeUndefined();
  });
});

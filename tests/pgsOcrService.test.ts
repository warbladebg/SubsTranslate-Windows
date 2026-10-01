import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ocrPgsSupToSrt } from "../src/main/pgsOcrService";

describe("PGS OCR service", () => {
  it("converts OCR text from PGS bitmaps into SRT content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgs-ocr-"));
    const supPath = join(dir, "sample.sup");
    await writeFile(supPath, createSyntheticSup());

    const srt = await ocrPgsSupToSrt(supPath, {
      recognizeImage: async (image, cue) => {
        expect(image.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(cue.width).toBe(2);
        return "Hello from PGS";
      }
    });

    expect(srt).toContain("00:00:00,000 --> 00:00:01,000");
    expect(srt).toContain("Hello from PGS");
  });

  it("tries alternate preprocessed images when the first OCR pass is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgs-ocr-"));
    const supPath = join(dir, "sample.sup");
    await writeFile(supPath, createSyntheticSup());
    let attempts = 0;

    const srt = await ocrPgsSupToSrt(supPath, {
      recognizeImage: async () => {
        attempts += 1;
        return attempts === 1 ? "" : "Recovered text";
      }
    });

    expect(attempts).toBe(2);
    expect(srt).toContain("Recovered text");
  });

  it("reports a local OCR failure without remote OCR fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgs-ocr-"));
    const supPath = join(dir, "sample.sup");
    await writeFile(supPath, createSyntheticSup());

    await expect(
      ocrPgsSupToSrt(supPath, {
        recognizeImage: async () => ""
      })
    ).rejects.toThrow(/Try another subtitle language track/);
  });

  it("fixes conservative English mid-sentence uppercase-I OCR errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgs-ocr-"));
    const supPath = join(dir, "sample.sup");
    await writeFile(supPath, createSyntheticSup());

    const srt = await ocrPgsSupToSrt(supPath, {
      language: "eng",
      recognizeImage: async () => "That's It. Cash\nIn the bag If needed and developing\nInto a success.\nl've finished."
    });

    expect(srt).toContain("That's it. Cash\nin the bag if needed and developing\ninto a success.\nI've finished.");
  });

  it("does not accept a high-confidence result that misses a visible bitmap line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgs-ocr-"));
    const supPath = join(dir, "two-lines.sup");
    await writeFile(supPath, createTwoLineSyntheticSup());
    let attempts = 0;

    const srt = await ocrPgsSupToSrt(supPath, {
      recognizeImage: async () => {
        attempts += 1;
        return attempts === 1
          ? { text: "Second line", confidence: 99 }
          : { text: "First line\nSecond line", confidence: 96 };
      }
    });

    expect(attempts).toBe(2);
    expect(srt).toContain("First line\nSecond line");
  });

  it("uses batched cue recognition without dropping line-preserved results", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgs-ocr-"));
    const supPath = join(dir, "two-lines.sup");
    await writeFile(supPath, createTwoLineSyntheticSup());
    let scalarCalls = 0;
    let batchCalls = 0;
    const recognizeImage = Object.assign(
      async () => {
        scalarCalls += 1;
        return "";
      },
      {
        recognizeCues: async (cues: unknown[]) => {
          batchCalls += 1;
          return cues.map(() => ({ text: "First line\nSecond line", confidence: 99 }));
        }
      }
    );

    const srt = await ocrPgsSupToSrt(supPath, { recognizeImage });

    expect(batchCalls).toBe(1);
    expect(scalarCalls).toBe(0);
    expect(srt).toContain("First line\nSecond line");
  });
});

function createSyntheticSup(): Buffer {
  return Buffer.concat([
    segment(0, 0x14, Buffer.from([0, 0, 1, 235, 128, 128, 255])),
    segment(0, 0x15, objectPayload()),
    segment(0, 0x16, presentationPayload(1)),
    segment(90000, 0x16, presentationPayload(0))
  ]);
}

function createTwoLineSyntheticSup(): Buffer {
  const rle = Buffer.from([
    1, 0, 0,
    0, 1, 0, 0,
    0, 1, 0, 0,
    0, 1, 0, 0,
    1, 0, 0
  ]);
  const object = Buffer.alloc(11 + rle.length);
  object.writeUInt16BE(1, 0);
  object[3] = 0xc0;
  object.writeUIntBE(rle.length, 4, 3);
  object.writeUInt16BE(1, 7);
  object.writeUInt16BE(5, 9);
  rle.copy(object, 11);
  return Buffer.concat([
    segment(0, 0x14, Buffer.from([0, 0, 1, 235, 128, 128, 255])),
    segment(0, 0x15, object),
    segment(0, 0x16, presentationPayload(1)),
    segment(90000, 0x16, presentationPayload(0))
  ]);
}

function segment(pts90k: number, type: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.write("PG", 0, "ascii");
  header.writeUInt32BE(pts90k, 2);
  header[10] = type;
  header.writeUInt16BE(payload.length, 11);
  return Buffer.concat([header, payload]);
}

function objectPayload(): Buffer {
  const payload = Buffer.alloc(13);
  payload.writeUInt16BE(1, 0);
  payload[3] = 0xc0;
  payload.writeUIntBE(2, 4, 3);
  payload.writeUInt16BE(2, 7);
  payload.writeUInt16BE(1, 9);
  payload[11] = 1;
  payload[12] = 1;
  return payload;
}

function presentationPayload(objectCount: number): Buffer {
  const payload = Buffer.alloc(objectCount > 0 ? 19 : 11);
  payload[10] = objectCount;
  if (objectCount > 0) {
    payload.writeUInt16BE(1, 11);
    payload.writeUInt16BE(12, 15);
    payload.writeUInt16BE(34, 17);
  }
  return payload;
}

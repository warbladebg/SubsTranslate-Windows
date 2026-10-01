import { describe, expect, it } from "vitest";
import { decodePgsRle, parsePgsSup } from "../src/core/subtitle/PgsParser";

describe("PGS subtitle parser", () => {
  it("decodes simple PGS RLE bitmap runs", () => {
    const rgba = decodePgsRle(
      Buffer.from([1, 0, 0x82, 1, 0, 0]),
      3,
      1,
      new Map([
        [1, { y: 235, cb: 128, cr: 128, alpha: 255 }]
      ])
    );

    expect([...rgba]).toEqual([
      235, 235, 235, 255,
      235, 235, 235, 255,
      235, 235, 235, 255
    ]);
  });

  it("does not skip rows when a full-width run is followed by an explicit EOL", () => {
    const rgba = decodePgsRle(
      Buffer.from([
        0, 0x83, 1, 0, 0,
        0, 0x83, 1, 0, 0
      ]),
      3,
      2,
      new Map([
        [1, { y: 235, cb: 128, cr: 128, alpha: 255 }]
      ])
    );

    const visiblePixels = [...rgba].filter((_value, index) => index % 4 === 3 && rgba[index] > 0);
    expect(visiblePixels).toHaveLength(6);
  });

  it("parses a visible bitmap cue from a SUP stream", () => {
    const cues = parsePgsSup(createSyntheticSup());

    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      id: 1,
      startMs: 0,
      endMs: 1000,
      width: 2,
      height: 1,
      x: 12,
      y: 34
    });
    expect(cues[0].rgba[3]).toBe(255);
    expect(cues[0].rgba[7]).toBe(255);
  });

  it("composites simultaneous PGS objects into one subtitle cue", () => {
    const input = Buffer.concat([
      segment(0, 0x16, multiObjectPresentationPayload()),
      segment(0, 0x14, Buffer.from([0, 0, 1, 235, 128, 128, 255])),
      segment(0, 0x15, singlePixelObjectPayload(1)),
      segment(0, 0x15, singlePixelObjectPayload(2)),
      segment(0, 0x80, Buffer.alloc(0)),
      segment(90000, 0x16, presentationPayload(0)),
      segment(90000, 0x80, Buffer.alloc(0))
    ]);

    const cues = parsePgsSup(input);

    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ startMs: 0, endMs: 1000, x: 10, y: 20, width: 3, height: 1 });
    expect(cues[0].rgba[3]).toBe(255);
    expect(cues[0].rgba[7]).toBe(0);
    expect(cues[0].rgba[11]).toBe(255);
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

function singlePixelObjectPayload(objectId: number): Buffer {
  const payload = Buffer.alloc(12);
  payload.writeUInt16BE(objectId, 0);
  payload[3] = 0xc0;
  payload.writeUIntBE(1, 4, 3);
  payload.writeUInt16BE(1, 7);
  payload.writeUInt16BE(1, 9);
  payload[11] = 1;
  return payload;
}

function multiObjectPresentationPayload(): Buffer {
  const payload = Buffer.alloc(27);
  payload[10] = 2;
  payload.writeUInt16BE(1, 11);
  payload.writeUInt16BE(10, 15);
  payload.writeUInt16BE(20, 17);
  payload.writeUInt16BE(2, 19);
  payload.writeUInt16BE(12, 23);
  payload.writeUInt16BE(20, 25);
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

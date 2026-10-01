import { describe, expect, it } from "vitest";
import {
  decodeSubtitleBytes,
  SubtitleEncodingId,
  subtitleEncodingProfiles
} from "../src/core/media/SubtitleEncodings";

const subtitleText = "1\r\n00:00:00,000 --> 00:00:00,800\r\nБългарски текст.\r\n";

describe("subtitle encodings", () => {
  it("offers the requested encoding menu in the expected order", () => {
    expect(subtitleEncodingProfiles.map((profile) => profile.label)).toEqual([
      "ANSI",
      "UTF-16 LE",
      "UTF-16 BE",
      "UTF-8",
      "UTF-8 with BOM"
    ]);
  });

  it.each([
    ["ansi", encodeWindows1251(subtitleText)],
    ["utf-16-le", withPrefix([0xff, 0xfe], Buffer.from(subtitleText, "utf16le"))],
    ["utf-16-be", withPrefix([0xfe, 0xff], encodeUtf16Be(subtitleText))],
    ["utf-8", Buffer.from(subtitleText, "utf8")],
    ["utf-8-bom", withPrefix([0xef, 0xbb, 0xbf], Buffer.from(subtitleText, "utf8"))]
  ] as Array<[SubtitleEncodingId, Buffer]>)("decodes %s Bulgarian subtitles", (encodingId, bytes) => {
    expect(decodeSubtitleBytes(bytes, encodingId)).toBe(subtitleText);
  });

  it("rejects invalid UTF-8 instead of silently corrupting text", () => {
    expect(() => decodeSubtitleBytes(Buffer.from([0xc3, 0x28]), "utf-8")).toThrow(/not valid UTF-8/i);
  });
});

function withPrefix(prefix: number[], content: Buffer): Buffer {
  return Buffer.concat([Buffer.from(prefix), content]);
}

function encodeUtf16Be(value: string): Buffer {
  const encoded = Buffer.from(value, "utf16le");
  for (let index = 0; index < encoded.length; index += 2) {
    [encoded[index], encoded[index + 1]] = [encoded[index + 1], encoded[index]];
  }
  return encoded;
}

function encodeWindows1251(value: string): Buffer {
  const cyrillicBytes: Record<string, number> = {
    Б: 0xc1,
    ъ: 0xfa,
    л: 0xeb,
    г: 0xe3,
    а: 0xe0,
    р: 0xf0,
    с: 0xf1,
    к: 0xea,
    и: 0xe8,
    т: 0xf2,
    е: 0xe5
  };

  return Buffer.from(
    [...value].map((character) => {
      const code = character.charCodeAt(0);
      if (code <= 0x7f) {
        return code;
      }
      const encoded = cyrillicBytes[character];
      if (encoded === undefined) {
        throw new Error(`Missing Windows-1251 test mapping for ${character}`);
      }
      return encoded;
    })
  );
}

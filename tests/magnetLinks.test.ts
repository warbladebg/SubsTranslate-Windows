import { describe, expect, it } from "vitest";
import { buildSanitizedMagnetUri, normalizeInfoHash, sanitizeTrackers } from "../src/core/discovery/MagnetLinks";

describe("magnet link security", () => {
  it("passes selected file indices without confusing them with episode numbers", () => {
    const source = { infoHash: "a".repeat(40), name: "Show", trackers: [] };
    expect(new URL(buildSanitizedMagnetUri(source, [7, 2, 7])).searchParams.get("so")).toBe("2,7");
    expect(new URL(buildSanitizedMagnetUri(source)).searchParams.has("so")).toBe(false);
    for (const indices of [[], [-1], [1.5], [NaN]]) {
      expect(() => buildSanitizedMagnetUri(source, indices)).toThrow(/Invalid torrent file selection/);
    }
  });

  it("reconstructs a magnet from normalized fields instead of trusting a provider URL", () => {
    const magnet = buildSanitizedMagnetUri({
      infoHash: "A".repeat(40),
      name: "Safe\r\nTitle\0",
      trackers: [
        "tracker:udp://tracker.example:80/announce",
        "https://tracker.example/announce",
        "https://user:password@tracker.example/private",
        "file:///tmp/evil"
      ]
    });

    expect(magnet).toMatch(/^magnet:\?/);
    expect(magnet).toContain(`xt=urn:btih:${"a".repeat(40)}`);
    expect(magnet).not.toContain("urn%3Abtih");
    expect(new URL(magnet).searchParams.get("dn")).toBe("Safe Title");
    expect(magnet).not.toContain("password");
    expect(magnet).not.toContain("file%3A");
  });

  it.each(["", "xyz", "a".repeat(39), "g".repeat(40), "a".repeat(64)])(
    "rejects an invalid v1 info hash: %s",
    (value) => expect(() => normalizeInfoHash(value)).toThrow(/invalid/i)
  );

  it("deduplicates trackers and rejects credentials, control characters, and unsupported protocols", () => {
    expect(sanitizeTrackers([
      "https://tracker.example/a",
      "https://tracker.example/a",
      "udp://tracker.example:80/a",
      "javascript:alert(1)",
      "https://user:pass@tracker.example/a",
      "https://tracker.example/a\nmalicious"
    ])).toEqual([
      "https://tracker.example/a",
      "udp://tracker.example:80/a"
    ]);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("torrent dependency security", () => {
  it("does not ship the former WebTorrent tracker and IP parser", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, unknown> };
    expect(lock.packages["node_modules/webtorrent"]).toBeUndefined();
    expect(lock.packages["node_modules/bittorrent-tracker"]).toBeUndefined();
    expect(lock.packages["node_modules/ip"]).toBeUndefined();
  });
});

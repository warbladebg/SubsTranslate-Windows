import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Electron security boundary", () => {
  it("uses context isolation and a preload bridge", async () => {
    const main = await readFile("src/main/index.ts", "utf8");
    const preload = await readFile("src/preload/index.ts", "utf8");

    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(preload).toContain("contextBridge.exposeInMainWorld");
  });

  it("stores provider API keys with Electron safeStorage", async () => {
    const settings = await readFile("src/main/settingsService.ts", "utf8");

    expect(settings).toContain("safeStorage.encryptString");
    expect(settings).toContain("safeStorage.decryptString");
    expect(settings).toContain("gemini-api-key.bin");
    expect(settings).toContain("vercel-ai-gateway-api-key.bin");
    expect(settings).toContain("real-debrid-api-token.bin");
    expect(settings).toContain("mdblist-api-key.bin");
    expect(settings).not.toContain("tmdb-read-token.bin");
  });

  it("keeps discovery credentials and resolved download URLs behind typed IPC", async () => {
    const preload = await readFile("src/preload/index.ts", "utf8");
    const realDebrid = await readFile("src/main/realDebridService.ts", "utf8");
    const catalog = await readFile("src/main/catalogService.ts", "utf8");
    const ratings = await readFile("src/main/multiSourceRatingsService.ts", "utf8");

    expect(preload).not.toContain("getRealDebridApiToken");
    expect(preload).not.toContain("getTmdbReadToken");
    expect(preload).not.toContain("setTmdbReadToken");
    expect(preload).not.toContain("getMdblistApiKey");
    expect(catalog).toContain('const CINEMETA_BASE_URL = "https://v3-cinemeta.strem.io"');
    expect(catalog).toContain('const CINEMETA_CATALOG_BASE_URL = "https://cinemeta-catalogs.strem.io/top"');
    expect(catalog).not.toContain("Authorization:");
    expect(ratings).toContain('const MDBLIST_BASE_URL = "https://api.mdblist.com"');
    expect(ratings).toContain('url.searchParams.set("apikey", apiKey)');
    expect(ratings).toContain('redirect: "error"');
    expect(realDebrid).toContain("Authorization: `Bearer ${token}`");
    expect(realDebrid).toContain('"/torrents/addMagnet"');
    expect(realDebrid).toContain("`/torrents/selectFiles/${encodeURIComponent(torrentId)}`");
    expect(realDebrid).toContain("buildSanitizedMagnetUri(source)");
    expect(realDebrid).toContain("await this.deleteTorrent(torrentId)");
    expect(realDebrid).toContain('source.cacheStatus !== "verified-account-cached"');
  });

  it("keeps the built-in torrent source origin fixed in the main process", async () => {
    const types = await readFile("src/core/discovery/DiscoveryTypes.ts", "utf8");
    const store = await readFile("src/main/discoveryStore.ts", "utf8");
    const main = await readFile("src/main/index.ts", "utf8");
    const preload = await readFile("src/preload/index.ts", "utf8");
    const aggregator = await readFile("src/main/sourceAggregatorService.ts", "utf8");

    expect(aggregator).toContain('baseUrl: "https://torrentio.strem.fun"');
    expect(aggregator).toContain('baseUrl: "https://comet.feels.legal"');
    expect(aggregator).toContain('baseUrl: "https://mediafusionfortheweebs.midnightignite.me"');
    expect(store).toContain('["torrentio", "comet", "mediafusion"]');
    expect(aggregator).toContain('redirect: "error"');
    expect(aggregator).toContain('headers: { Accept: "application/json" }');
    expect(aggregator).not.toContain("Authorization");
    expect(aggregator).not.toContain("process.env");
    expect(aggregator).toContain("realDebridApiToken?: string");
    expect(main).toContain("settingsService.getRealDebridApiToken()");
    expect(preload).not.toContain("realDebridApiToken");
    expect(types).not.toContain("realDebridApiToken");
    for (const rendererBoundary of [types, main, preload]) {
      expect(rendererBoundary).not.toContain("sourceAddonUrls");
      expect(rendererBoundary).not.toContain("addonUrls");
    }
    expect(store).not.toContain("normalizeAddonBaseUrl");
    expect(store).toContain('const LEGACY_SOURCE_URLS_KEY = "sourceAddonUrls"');
  });

  it("uses a restrictive renderer content security policy", async () => {
    const html = await readFile("index.html", "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("https://images.metahub.space");
    expect(html).not.toContain("https://image.tmdb.org");
  });
});

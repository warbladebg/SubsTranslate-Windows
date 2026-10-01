import { describe, expect, it } from "vitest";
import { selectTrustedDevServerUrl, TRUSTED_DEV_SERVER_URL } from "../src/main/devServerUrl";

describe("trusted Electron development server URL", () => {
  it.each([TRUSTED_DEV_SERVER_URL, `${TRUSTED_DEV_SERVER_URL}/`])(
    "allows the fixed loopback development origin while unpackaged: %s",
    (url) => {
      expect(selectTrustedDevServerUrl(url, false)).toBe(TRUSTED_DEV_SERVER_URL);
    }
  );

  it.each([
    undefined,
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "https://127.0.0.1:5173",
    "https://example.com",
    "http://127.0.0.1:5173.example.com"
  ])("rejects an untrusted development URL: %s", (url) => {
    expect(selectTrustedDevServerUrl(url, false)).toBeUndefined();
  });

  it("never loads a development URL in a packaged build", () => {
    expect(selectTrustedDevServerUrl(TRUSTED_DEV_SERVER_URL, true)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { parsePublicHttpsUrl } from "../src/main/publicHttpsUrl";

describe("public download URL policy", () => {
  it.each([
    "http://cdn.example/file", "https://user:password@cdn.example/file",
    "https://localhost./file", "https://printer.local/file", "https://0.0.0.0/file",
    "https://127.1/file", "https://10.0.0.1/file", "https://172.31.0.1/file",
    "https://192.168.1.1/file", "https://169.254.1.1/file", "https://[::]/file",
    "https://[::1]/file", "https://[fd00::1]/file", "https://[febf::1]/file",
    "https://[::ffff:127.0.0.1]/file", "https://[::ffff:192.168.0.1]/file"
  ])("rejects unsafe links: %s", (url) => expect(parsePublicHttpsUrl(url)).toBeUndefined());

  it.each([
    "https://cdn.example/file", "https://fcdn.example/file", "https://fd.example/file",
    "https://172.32.0.1/file", "https://[2606:4700:4700::1111]/file"
  ])("allows public HTTPS links: %s", (url) => expect(parsePublicHttpsUrl(url)?.href).toBe(url));
});

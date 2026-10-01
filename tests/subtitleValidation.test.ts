import { expect, it } from "vitest";
import { verifyEmbeddedCues } from "../src/main/subtitleValidation";

const first = "1\n00:00:00,000 --> 00:00:01,000\nЗдравей.\n";
const second = "\n2\n00:00:02,000 --> 00:00:03,000\nДа.\n";
it("accepts a complete embedded subtitle round trip", () => {
  expect(() => verifyEmbeddedCues(first + second, first + second)).not.toThrow();
});
it("rejects an empty embedded track", () => {
  expect(() => verifyEmbeddedCues(first, "")).toThrow(/no readable cues/i);
});
it("rejects truncated embedded subtitles even when a track exists", () => {
  expect(() => verifyEmbeddedCues(first + second, first)).toThrow(/verification/i);
});
it("rejects shifted embedded timings", () => {
  expect(() => verifyEmbeddedCues(first, first.replace("00:00:00,000", "00:00:00,500"))).toThrow(/verification/i);
});
it("rejects lost dialogue with otherwise identical timings and cue counts", () => {
  expect(() => verifyEmbeddedCues(first, first.replace("Здравей.", "Друго."))).toThrow(/verification/i);
});

import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { classifySubtitleCodec, getSubtitleExportExtension, type SubtitleTrack } from "../src/core/video/SubtitleTrack";
import { exportSubtitleTrack, exportSubtitleTracks } from "../src/main/subtitleExportService";
import { extractSubtitleTrack } from "../src/main/subtitleExtractionService";
import { runProcess } from "../src/main/processUtils";
vi.mock("../src/main/subtitleExtractionService", () => ({ extractSubtitleTrack: vi.fn() }));
vi.mock("../src/main/processUtils", () => ({ runProcess: vi.fn() }));
const content = "1\n00:00:02,100 --> 00:00:04,200\nOriginal words, not translated.\n";
const track = (codecName: string, index = 7): SubtitleTrack => ({ index, codecName, codecType: "subtitle", language: "eng", title: "Full", ...classifySubtitleCodec(codecName) });
beforeEach(() => vi.resetAllMocks());
it("exports PGS OCR content as a real SRT file without copying the SUP", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-ocr-"));
  vi.mocked(extractSubtitleTrack).mockResolvedValue({ filePath: "internal.sup", format: "srt", content });
  const controller = new AbortController();
  const onProgress = vi.fn();
  const request = { videoPath: "source.mkv", track: track("hdmv_pgs_subtitle"), outputDirectory };
  const result = await exportSubtitleTrack(request, controller.signal, onProgress);
  expect(result.outputPath.endsWith(".srt")).toBe(true);
  expect(await readFile(result.outputPath, "utf8")).toBe(content);
  expect(extractSubtitleTrack).toHaveBeenCalledWith("source.mkv", expect.objectContaining({ index: 7, requiresOcr: true }), { signal: controller.signal, onProgress });
  expect(runProcess).not.toHaveBeenCalled();
  const second = await exportSubtitleTrack(request);
  expect(second.outputPath).not.toBe(result.outputPath);
  expect(await readFile(result.outputPath, "utf8")).toBe(content);
});
it("uses OCR for every PGS track in Export all", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-all-ocr-"));
  vi.mocked(extractSubtitleTrack).mockResolvedValue({ filePath: "internal.sup", format: "srt", content });
  const result = await exportSubtitleTracks({ videoPath: "source.mkv", tracks: [track("pgssub", 4), track("hdmv_pgs_subtitle", 8)], outputDirectory });
  expect(result.exported.map(item => item.trackIndex)).toEqual([4, 8]);
  for (const item of result.exported) expect(await readFile(item.outputPath, "utf8")).toBe(content);
});
it("does not leave a falsely labelled SRT when OCR fails", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-failed-ocr-"));
  vi.mocked(extractSubtitleTrack).mockRejectedValue(new Error("OCR failed"));
  await expect(exportSubtitleTrack({ videoPath: "source.mkv", track: track("pgssub"), outputDirectory })).rejects.toThrow("OCR failed");
  expect(await readdir(outputDirectory)).toEqual([]);
});
it("honors cancellation before OCR starts", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-cancel-"));
  const controller = new AbortController();
  controller.abort();
  await expect(exportSubtitleTrack({ videoPath: "source.mkv", track: track("pgssub"), outputDirectory }, controller.signal)).rejects.toThrow();
  expect(extractSubtitleTrack).not.toHaveBeenCalled();
});
it.each(["subrip", "ass", "ssa", "webvtt", "mov_text"])("converts %s exports to SRT", async codec => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-text-"));
  vi.mocked(runProcess).mockResolvedValue({ stdout: content, stderr: "" });
  const result = await exportSubtitleTrack({ videoPath: "source.mkv", track: track(codec), outputDirectory });
  expect(getSubtitleExportExtension(track(codec))).toBe("srt");
  expect(result.outputPath.endsWith(".srt")).toBe(true);
  expect(runProcess).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["-map", "0:7", "-c:s", "srt"]), undefined);
  expect(extractSubtitleTrack).not.toHaveBeenCalled();
  expect(await readFile(result.outputPath, "utf8")).toBe(content);
});

it.each(["", "   ", "not subtitles", "1\n00:00:00,000 --> 00:00:01,000\n"])("rejects empty or unreadable successful FFmpeg output", async stdout => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-empty-"));
  vi.mocked(runProcess).mockResolvedValue({ stdout, stderr: "" });
  await expect(exportSubtitleTrack({ videoPath: "source.mkv", track: track("subrip"), outputDirectory })).rejects.toThrow(/no readable cues/i);
  expect(await readdir(outputDirectory)).toEqual([]);
});

it("rejects empty OCR output without publishing a file", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-empty-ocr-"));
  vi.mocked(extractSubtitleTrack).mockResolvedValue({ filePath: "internal.sup", format: "srt", content: "" });
  await expect(exportSubtitleTrack({ videoPath: "source.mkv", track: track("pgssub"), outputDirectory })).rejects.toThrow(/no readable cues/i);
  expect(await readdir(outputDirectory)).toEqual([]);
});

it("does not expose a final SRT while FFmpeg is still extracting", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-pending-"));
  vi.mocked(runProcess).mockImplementation(async () => {
    expect(await readdir(outputDirectory)).toEqual([]);
    return { stdout: content, stderr: "" };
  });
  const result = await exportSubtitleTrack({ videoPath: "source.mkv", track: track("subrip"), outputDirectory });
  expect(await readFile(result.outputPath, "utf8")).toBe(content);
});

it("leaves no export after cancellation during extraction", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "export-cancel-text-"));
  const controller = new AbortController();
  vi.mocked(runProcess).mockImplementation(async () => {
    controller.abort();
    return { stdout: content, stderr: "" };
  });
  await expect(exportSubtitleTrack({ videoPath: "source.mkv", track: track("subrip"), outputDirectory }, controller.signal)).rejects.toThrow();
  expect(await readdir(outputDirectory)).toEqual([]);
});

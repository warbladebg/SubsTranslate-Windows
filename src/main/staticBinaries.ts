import { createRequire } from "node:module";

const nodeRequire = createRequire(__filename);

export function getFfprobePath(): string {
  const ffprobeStatic = nodeRequire("ffprobe-static") as { path: string };
  return ffprobeStatic.path;
}

export function getFfmpegPath(): string {
  const ffmpegPath = nodeRequire("ffmpeg-static") as string | null;
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary was not found.");
  }
  return ffmpegPath;
}

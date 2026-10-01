import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, join, parse } from "node:path";
import { parseSrt } from "../core/subtitle/SrtParser";
import { pathExists } from "./fsUtils";
import { errorMessage } from "../core/util/errors";

export type OutputConflictMode = "overwrite" | "versioned" | "cancel";

export async function canWriteToDirectory(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function getDefaultOutputPath(videoPath: string, targetLanguageCode = "bg"): string {
  const parsed = parse(videoPath);
  return join(parsed.dir, `${parsed.name}.${targetLanguageCode}.srt`);
}

export async function writeSrtSafely(
  outputPath: string,
  content: string,
  conflictMode: OutputConflictMode
): Promise<string> {
  const finalPath = await resolveConflictPath(outputPath, conflictMode);
  await ensureOutputDirectory(dirname(finalPath));

  const tempPath = `${finalPath}.tmp-${Date.now()}`;
  await writeFile(tempPath, content, "utf8");

  try {
    const parsed = parseSrt(await readFile(tempPath, "utf8"));
    if (parsed.cues.length === 0) {
      throw new Error("No subtitle cues found.");
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new Error(`Generated SRT failed validation: ${errorMessage(error)}`, { cause: error });
  }

  if (conflictMode === "overwrite") {
    await rm(finalPath, { force: true });
  }

  await rename(tempPath, finalPath);
  return finalPath;
}

export async function ensureOutputDirectory(directoryPath: string): Promise<void> {
  try {
    const existing = await stat(directoryPath);
    if (existing.isDirectory()) {
      return;
    }
    throw new Error(`Output path ${directoryPath} exists but is not a directory.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(directoryPath, { recursive: true });
}

/** Applies the conflict mode when `outputPath` exists; "versioned" appends .2, .3, … before the extension. */
export async function resolveConflictPath(outputPath: string, conflictMode: OutputConflictMode): Promise<string> {
  if (!(await pathExists(outputPath))) {
    return outputPath;
  }

  if (conflictMode === "cancel") {
    throw new Error("Output file already exists.");
  }

  if (conflictMode === "overwrite") {
    return outputPath;
  }

  const extension = extname(outputPath);
  const base = outputPath.slice(0, -extension.length);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}.${index}${extension}`;
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not find an available filename for ${basename(outputPath)}.`);
}

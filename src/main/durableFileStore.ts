import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export function getDurableBackupPath(filePath: string): string {
  return `${filePath}.bak`;
}

export async function readJsonWithBackup<T>(
  filePath: string,
  normalize: (value: unknown) => T
): Promise<T | undefined> {
  const primary = await tryReadJson(filePath, normalize);
  if (primary) {
    return primary.value;
  }

  const backup = await tryReadJson(getDurableBackupPath(filePath), normalize);
  if (!backup) {
    return undefined;
  }

  // A missing primary is the expected crash state after the old file has been
  // moved aside but before the replacement has been installed. Repair it on a
  // best-effort basis while retaining the backup as the last known-good copy.
  await restorePrimary(filePath, backup.text).catch(() => undefined);
  return backup.value;
}

export async function replaceJsonWithBackup(filePath: string, value: unknown): Promise<void> {
  await replaceTextWithBackup(filePath, JSON.stringify(value, null, 2));
}

export async function replaceJsonWithSanitizedBackup(filePath: string, value: unknown): Promise<void> {
  const content = JSON.stringify(value, null, 2);
  // Scrub the backup first so it is always a safe recovery source while the
  // primary is replaced. This path is reserved for migrations that remove
  // legacy secrets or credential-bearing configuration.
  await replaceExactText(getDurableBackupPath(filePath), content);
  await replaceExactText(filePath, content);
}

export async function replaceTextWithBackup(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const backupPath = getDurableBackupPath(filePath);
  const tempPath = temporaryPath(filePath, "new");
  try {
    await writeSyncedText(tempPath, content);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  let movedPrimary = false;
  try {
    if (await fileExists(filePath)) {
      // Removing an older backup is safe while the current primary is still in
      // place. From the following rename until installation of the temp file,
      // the backup is the recoverable copy.
      await rm(backupPath, { force: true });
      await rename(filePath, backupPath);
      movedPrimary = true;
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    if (movedPrimary) {
      await rename(backupPath, filePath).catch(() => undefined);
    }
    throw error;
  }
}

export async function removeFileAndBackup(filePath: string): Promise<void> {
  await Promise.all([
    rm(filePath, { force: true }),
    rm(getDurableBackupPath(filePath), { force: true })
  ]);
}

async function tryReadJson<T>(
  filePath: string,
  normalize: (value: unknown) => T
): Promise<{ text: string; value: T } | undefined> {
  try {
    const text = await readFile(filePath, "utf8");
    return { text, value: normalize(JSON.parse(text)) };
  } catch {
    return undefined;
  }
}

function restorePrimary(filePath: string, content: string): Promise<void> {
  return replaceExactText(filePath, content, "recover");
}

/** Writes `content` to a synced temporary file, then swaps it in place of `filePath`. */
async function replaceExactText(filePath: string, content: string, purpose = "sanitize"): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = temporaryPath(filePath, purpose);
  try {
    await writeSyncedText(tempPath, content);
    await rm(filePath, { force: true });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeSyncedText(filePath: string, content: string): Promise<void> {
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const handle = await open(filePath, "r");
    await handle.close();
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function temporaryPath(filePath: string, purpose: string): string {
  return `${filePath}.${purpose}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getDurableBackupPath,
  readJsonWithBackup,
  replaceJsonWithBackup
} from "../src/main/durableFileStore";

describe("durable file store", () => {
  it("retains the prior value and recovers it from an interrupted replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "durable-file-store-"));
    const storePath = join(directory, "store.json");
    await replaceJsonWithBackup(storePath, { revision: 1 });
    await replaceJsonWithBackup(storePath, { revision: 2 });

    expect(JSON.parse(await readFile(getDurableBackupPath(storePath), "utf8"))).toEqual({ revision: 1 });
    await rm(storePath);

    const recovered = await readJsonWithBackup(storePath, normalizeRevision);
    expect(recovered).toEqual({ revision: 1 });
    expect(JSON.parse(await readFile(storePath, "utf8"))).toEqual({ revision: 1 });
  });

  it("uses the last known-good backup when the primary is unreadable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "durable-file-store-"));
    const storePath = join(directory, "store.json");
    await replaceJsonWithBackup(storePath, { revision: 1 });
    await replaceJsonWithBackup(storePath, { revision: 2 });
    await writeFile(storePath, "{truncated", "utf8");

    expect(await readJsonWithBackup(storePath, normalizeRevision)).toEqual({ revision: 1 });
    expect(JSON.parse(await readFile(storePath, "utf8"))).toEqual({ revision: 1 });
  });
});

function normalizeRevision(value: unknown): { revision: number } {
  if (!value || typeof value !== "object" || !("revision" in value) || typeof value.revision !== "number") {
    throw new Error("Invalid revision.");
  }
  return { revision: value.revision };
}

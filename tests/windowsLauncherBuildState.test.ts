import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  unlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const describeOnWindows = process.platform === "win32" ? describe : describe.skip;
const helperPath = resolve("scripts", "launch-build-state.ps1");
const fixtureDirectories: string[] = [];

describeOnWindows("Windows launcher build freshness", () => {
  afterEach(async () => {
    await Promise.all(fixtureDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it("skips the build when every required output is newer than all inputs", async () => {
    const repositoryRoot = await createFixture();

    expect(isBuildRequired(repositoryRoot)).toBe(false);
  });

  it.each([
    ["a nested source file", join("src", "renderer", "App.tsx")],
    ["a public asset", join("public", "app-icon.png")],
    ["a root build configuration file", "vite.config.ts"]
  ])("requires a build when %s is newer", async (_label, relativePath) => {
    const repositoryRoot = await createFixture();
    await setTimestamp(join(repositoryRoot, relativePath), NEWER_INPUT_TIME);

    expect(isBuildRequired(repositoryRoot)).toBe(true);
  });

  it.each([
    join("dist", "index.html"),
    join("dist-electron", "main", "index.js"),
    join("dist-electron", "preload", "index.js")
  ])("requires a build when %s is missing", async (relativePath) => {
    const repositoryRoot = await createFixture();
    await unlink(join(repositoryRoot, relativePath));

    expect(isBuildRequired(repositoryRoot)).toBe(true);
  });
});

const INPUT_TIME = new Date("2026-01-01T00:00:00.000Z");
const OUTPUT_TIME = new Date("2026-01-01T00:01:00.000Z");
const NEWER_INPUT_TIME = new Date("2026-01-01T00:02:00.000Z");

const INPUT_FILES = [
  join("src", "renderer", "App.tsx"),
  join("src", "main", "index.ts"),
  join("public", "app-icon.png"),
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.electron.json",
  "vite.config.ts"
];

const OUTPUT_FILES = [
  join("dist", "index.html"),
  join("dist-electron", "main", "index.js"),
  join("dist-electron", "preload", "index.js")
];

async function createFixture(): Promise<string> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "substranslate-launcher-"));
  fixtureDirectories.push(repositoryRoot);

  for (const relativePath of INPUT_FILES) {
    await createTimestampedFile(repositoryRoot, relativePath, INPUT_TIME);
  }
  for (const relativePath of OUTPUT_FILES) {
    await createTimestampedFile(repositoryRoot, relativePath, OUTPUT_TIME);
  }

  return repositoryRoot;
}

async function createTimestampedFile(
  repositoryRoot: string,
  relativePath: string,
  timestamp: Date
): Promise<void> {
  const path = join(repositoryRoot, relativePath);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, "fixture", "utf8");
  await setTimestamp(path, timestamp);
}

async function setTimestamp(path: string, timestamp: Date): Promise<void> {
  await utimes(path, timestamp, timestamp);
}

function isBuildRequired(repositoryRoot: string): boolean {
  const command = [
    `. '${escapePowerShellLiteral(helperPath)}'`,
    `$result = Test-SubsTranslateBuildRequired -RepositoryRoot '${escapePowerShellLiteral(repositoryRoot)}'`,
    "if ($result) { Write-Output 'required' } else { Write-Output 'current' }"
  ].join("; ");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8" }
  ).trim();

  return output === "required";
}

function escapePowerShellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

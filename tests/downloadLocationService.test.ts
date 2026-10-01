import { access, mkdtemp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DownloadLocationService } from "../src/main/downloadLocationService";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DownloadLocationService", () => {
  it("skips drive discovery when there are no external locations", async () => {
    const root = await temporaryDirectory();
    let driveDiscoveryCalls = 0;
    const service = new DownloadLocationService({
      storePath: join(root, "locations.json"),
      driveRoots: async () => {
        driveDiscoveryCalls += 1;
        return [];
      }
    });
    await service.ensureInitialLocation(join(root, "Internal"));

    const scanned = await service.scanExternalLocations();
    expect(scanned.locations).toHaveLength(1);
    expect(driveDiscoveryCalls).toBe(0);

    await service.add(join(root, "External"), true);
    const connected = await service.scanExternalLocations();
    expect(connected.locations).toHaveLength(2);
    expect(driveDiscoveryCalls).toBe(0);
  });

  it("migrates an initial folder and manages multiple locations without deleting files", async () => {
    const root = await temporaryDirectory();
    const first = join(root, "Internal");
    const second = join(root, "Second");
    const service = new DownloadLocationService({ storePath: join(root, "locations.json") });

    const initial = await service.ensureInitialLocation(first);
    expect(initial.locations).toHaveLength(1);
    expect(initial.locations[0]).toMatchObject({
      path: first,
      isDefault: true,
      isAvailable: true
    });

    const added = await service.add(second);
    expect(added.locations).toHaveLength(2);
    const secondLocation = added.locations.find((location) => location.path === second)!;
    const changedDefault = await service.setDefault(secondLocation.id);
    expect(changedDefault.defaultLocationId).toBe(secondLocation.id);

    await expect(service.add(second)).rejects.toThrow("already a download location");
    const removed = await service.remove(initial.locations[0].id);
    expect(removed.locations).toHaveLength(1);
    await expect(service.remove(secondLocation.id)).rejects.toThrow("At least one");
    await expect(access(join(first, "Movies"))).resolves.toBeUndefined();
  });

  it("rediscovers an external library when its volume root changes", async () => {
    const root = await temporaryDirectory();
    const firstDrive = join(root, "drive-one");
    const secondDrive = join(root, "drive-two");
    await Promise.all([mkdir(firstDrive), mkdir(secondDrive)]);
    let activeVolumeRoot = firstDrive;
    const service = new DownloadLocationService({
      storePath: join(root, "locations.json"),
      driveRoots: async () => [secondDrive],
      volumeRoot: () => activeVolumeRoot
    });
    await service.ensureInitialLocation(join(root, "Internal"));
    const externalPath = join(firstDrive, "TV Media", "SubsTranslate");
    const added = await service.add(externalPath, true);
    const external = added.locations.find((location) => location.path === externalPath)!;

    const marker = JSON.parse(await readFile(
      join(externalPath, ".substranslate", "location.json"),
      "utf8"
    ));
    expect(marker.locationId).toBe(external.id);

    await mkdir(join(secondDrive, "TV Media"), { recursive: true });
    await rename(join(firstDrive, "TV Media", "SubsTranslate"), join(secondDrive, "TV Media", "SubsTranslate"));
    await expect(service.resolveDestination(external.id)).rejects.toThrow("not connected");

    activeVolumeRoot = secondDrive;
    const scanned = await service.scanExternalLocations();
    expect(scanned.locations.find((location) => location.id === external.id)).toMatchObject({
      path: join(secondDrive, "TV Media", "SubsTranslate"),
      isAvailable: true
    });
  });

  it("will not make a disconnected location the default", async () => {
    const root = await temporaryDirectory();
    const service = new DownloadLocationService({ storePath: join(root, "locations.json") });
    await service.ensureInitialLocation(join(root, "Internal"));
    const state = await service.add(join(root, "Removable"), true);
    const removable = state.locations.find((location) => location.isExternal)!;
    await rm(removable.path, { recursive: true, force: true });

    await expect(service.setDefault(removable.id)).rejects.toThrow("missing drive");
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "download-location-service-"));
  temporaryDirectories.push(path);
  return path;
}

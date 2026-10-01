import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, join, parse, relative, resolve } from "node:path";
import type { DownloadLocation, DownloadLocationState } from "../core/downloads/DownloadLocations";
import { readJsonWithBackup, replaceJsonWithBackup } from "./durableFileStore";
import { pathExists } from "./fsUtils";
import { DownloadedLibraryService } from "./downloadedLibraryService";

const STORE_VERSION = 1;
const MARKER_VERSION = 1;
const MARKER_DIRECTORY = ".substranslate";
const MARKER_FILENAME = "location.json";

interface StoredDownloadLocation {
  id: string;
  label: string;
  path: string;
  isExternal: boolean;
  markerNonce?: string;
  relativePath?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

interface StoredDownloadLocationState {
  version: 1;
  locations: StoredDownloadLocation[];
  defaultLocationId: string;
}

interface LocationMarker {
  version: 1;
  locationId: string;
  nonce: string;
}

export interface DownloadLocationServiceOptions {
  storePath?: string;
  libraryService?: DownloadedLibraryService;
  driveRoots?: () => Promise<string[]>;
  volumeRoot?: (path: string) => string;
}

export class DownloadLocationService {
  private readonly storePath: string;
  private readonly libraryService: DownloadedLibraryService;
  private readonly driveRoots: () => Promise<string[]>;
  private readonly volumeRoot: (path: string) => string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: DownloadLocationServiceOptions = {}) {
    this.storePath = options.storePath ?? join(app.getPath("userData"), "download-locations.json");
    this.libraryService = options.libraryService ?? new DownloadedLibraryService();
    this.driveRoots = options.driveRoots ?? discoverWindowsDriveRoots;
    this.volumeRoot = options.volumeRoot ?? ((path) => parse(resolve(path)).root);
  }

  async ensureInitialLocation(path: string): Promise<DownloadLocationState> {
    const normalizedPath = resolveRequiredPath(path);
    return this.enqueue(async () => {
      const current = await this.read();
      if (current.locations.length === 0) {
        await this.libraryService.ensureStructure(normalizedPath);
        const now = new Date().toISOString();
        const location = createStoredLocation(normalizedPath, false, now);
        const next: StoredDownloadLocationState = {
          version: STORE_VERSION,
          locations: [location],
          defaultLocationId: location.id
        };
        await this.write(next);
        return this.toPublicState(next);
      }
      return this.toPublicState(current);
    });
  }

  async list(): Promise<DownloadLocationState> {
    return this.toPublicState(await this.read());
  }

  async add(path: string, isExternal = false): Promise<DownloadLocationState> {
    const normalizedPath = resolveRequiredPath(path);
    return this.enqueue(async () => {
      const current = await this.read();
      if (current.locations.some((location) => equalPath(location.path, normalizedPath))) {
        throw new Error("That folder is already a download location.");
      }
      await this.libraryService.ensureStructure(normalizedPath);
      const now = new Date().toISOString();
      const location = createStoredLocation(normalizedPath, isExternal, now);
      if (isExternal) {
        location.relativePath = relative(this.volumeRoot(normalizedPath), normalizedPath);
      }
      if (isExternal) {
        await this.writeMarker(location);
      }
      const next: StoredDownloadLocationState = {
        version: STORE_VERSION,
        locations: [...current.locations, location],
        defaultLocationId: current.defaultLocationId || location.id
      };
      await this.write(next);
      return this.toPublicState(next);
    });
  }

  async setDefault(id: string): Promise<DownloadLocationState> {
    return this.enqueue(async () => {
      const current = await this.read();
      const location = requireLocation(current, id);
      if (!await this.isAvailable(location)) {
        throw new Error("A missing drive cannot be the default download location.");
      }
      const next = {
        ...current,
        defaultLocationId: location.id,
        locations: current.locations.map((item) => item.id === id
          ? { ...item, updatedAt: new Date().toISOString() }
          : item)
      };
      await this.write(next);
      return this.toPublicState(next);
    });
  }

  async setExternal(id: string, isExternal: boolean): Promise<DownloadLocationState> {
    return this.enqueue(async () => {
      const current = await this.read();
      const existing = requireLocation(current, id);
      if (!await pathExists(existing.path)) {
        throw new Error("Connect the drive before changing its external-drive setting.");
      }
      const now = new Date().toISOString();
      const nextLocation: StoredDownloadLocation = {
        ...existing,
        isExternal,
        markerNonce: isExternal ? existing.markerNonce ?? randomUUID() : undefined,
        relativePath: isExternal ? relative(this.volumeRoot(existing.path), existing.path) : undefined,
        updatedAt: now,
        lastSeenAt: now
      };
      if (isExternal) {
        await this.writeMarker(nextLocation);
      }
      const next = {
        ...current,
        locations: current.locations.map((location) => location.id === id ? nextLocation : location)
      };
      await this.write(next);
      return this.toPublicState(next);
    });
  }

  async remove(id: string): Promise<DownloadLocationState> {
    return this.enqueue(async () => {
      const current = await this.read();
      requireLocation(current, id);
      if (current.locations.length === 1) {
        throw new Error("At least one download location must remain.");
      }
      const locations = current.locations.filter((location) => location.id !== id);
      const defaultLocationId = current.defaultLocationId === id
        ? locations[0].id
        : current.defaultLocationId;
      const next = { ...current, locations, defaultLocationId };
      await this.write(next);
      return this.toPublicState(next);
    });
  }

  async scanExternalLocations(): Promise<DownloadLocationState> {
    return this.enqueue(async () => {
      const current = await this.read();
      if (!current.locations.some((location) => location.isExternal)) {
        return this.toPublicState(current);
      }
      let rootsPromise: Promise<string[]> | undefined;
      let changed = false;
      const locations: StoredDownloadLocation[] = [];
      for (const location of current.locations) {
        if (!location.isExternal) {
          locations.push(location);
          continue;
        }
        const exactMarker = await this.readMarker(location.path);
        if (markerMatches(exactMarker, location)) {
          const now = new Date().toISOString();
          locations.push({ ...location, lastSeenAt: now });
          changed ||= location.lastSeenAt !== now;
          continue;
        }
        let foundPath: string | undefined;
        const roots = await (rootsPromise ??= this.driveRoots());
        for (const root of roots) {
          const candidate = resolve(root, location.relativePath || "");
          const marker = await this.readMarker(candidate);
          if (markerMatches(marker, location)) {
            foundPath = candidate;
            break;
          }
        }
        if (foundPath) {
          const now = new Date().toISOString();
          locations.push({ ...location, path: foundPath, updatedAt: now, lastSeenAt: now });
          changed = true;
        } else {
          locations.push(location);
        }
      }
      const next = { ...current, locations };
      if (changed) {
        await this.write(next);
      }
      return this.toPublicState(next);
    });
  }

  async resolveDestination(id?: string): Promise<DownloadLocation> {
    const state = await this.list();
    const location = state.locations.find((item) => item.id === (id || state.defaultLocationId));
    if (!location) {
      throw new Error("Choose a download location in Settings.");
    }
    if (!location.isAvailable) {
      throw new Error(`${location.label} is not connected. Connect it or choose another download location.`);
    }
    return location;
  }

  private async read(): Promise<StoredDownloadLocationState> {
    return await readJsonWithBackup(this.storePath, normalizeStore) ?? {
      version: STORE_VERSION,
      locations: [],
      defaultLocationId: ""
    };
  }

  private async write(state: StoredDownloadLocationState): Promise<void> {
    await replaceJsonWithBackup(this.storePath, state);
  }

  private async toPublicState(state: StoredDownloadLocationState): Promise<DownloadLocationState> {
    const locations = await Promise.all(state.locations.map(async (location): Promise<DownloadLocation> => ({
      id: location.id,
      label: location.label,
      path: location.path,
      isExternal: location.isExternal,
      isAvailable: await this.isAvailable(location),
      isDefault: location.id === state.defaultLocationId,
      createdAt: location.createdAt,
      updatedAt: location.updatedAt,
      lastSeenAt: location.lastSeenAt
    })));
    return {
      locations,
      defaultLocationId: state.defaultLocationId,
      scannedAt: new Date().toISOString()
    };
  }

  private async isAvailable(location: StoredDownloadLocation): Promise<boolean> {
    if (!location.isExternal) {
      return pathExists(location.path);
    }
    return markerMatches(await this.readMarker(location.path), location);
  }

  private async writeMarker(location: StoredDownloadLocation): Promise<void> {
    if (!location.markerNonce) {
      throw new Error("External download location marker is missing an identity.");
    }
    await mkdir(join(location.path, MARKER_DIRECTORY), { recursive: true });
    await replaceJsonWithBackup(join(location.path, MARKER_DIRECTORY, MARKER_FILENAME), {
      version: MARKER_VERSION,
      locationId: location.id,
      nonce: location.markerNonce
    } satisfies LocationMarker);
  }

  private async readMarker(path: string): Promise<LocationMarker | undefined> {
    try {
      const value = JSON.parse(await readFile(join(path, MARKER_DIRECTORY, MARKER_FILENAME), "utf8"));
      if (
        value?.version === MARKER_VERSION
        && typeof value.locationId === "string"
        && typeof value.nonce === "string"
      ) {
        return value as LocationMarker;
      }
    } catch {
      // Missing, disconnected, or malformed markers all mean this is not the expected drive.
    }
    return undefined;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function createStoredLocation(path: string, isExternal: boolean, now: string): StoredDownloadLocation {
  const id = randomUUID();
  return {
    id,
    label: basename(path) || path,
    path,
    isExternal,
    markerNonce: isExternal ? randomUUID() : undefined,
    relativePath: isExternal ? relative(parse(path).root, path) : undefined,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now
  };
}

function normalizeStore(value: unknown): StoredDownloadLocationState {
  const input = value && typeof value === "object" ? value as Partial<StoredDownloadLocationState> : {};
  const locations = Array.isArray(input.locations)
    ? input.locations.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Partial<StoredDownloadLocation>;
      if (
        typeof item.id !== "string"
        || typeof item.path !== "string"
        || typeof item.createdAt !== "string"
        || typeof item.updatedAt !== "string"
      ) return [];
      return [{
        id: item.id,
        label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : basename(item.path) || item.path,
        path: resolve(item.path),
        isExternal: item.isExternal === true,
        markerNonce: typeof item.markerNonce === "string" ? item.markerNonce : undefined,
        relativePath: typeof item.relativePath === "string" ? item.relativePath : undefined,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        lastSeenAt: typeof item.lastSeenAt === "string" ? item.lastSeenAt : undefined
      } satisfies StoredDownloadLocation];
    })
    : [];
  const requestedDefault = typeof input.defaultLocationId === "string" ? input.defaultLocationId : "";
  return {
    version: STORE_VERSION,
    locations,
    defaultLocationId: locations.some((location) => location.id === requestedDefault)
      ? requestedDefault
      : locations[0]?.id ?? ""
  };
}

function requireLocation(state: StoredDownloadLocationState, id: string): StoredDownloadLocation {
  const location = state.locations.find((item) => item.id === id);
  if (!location) {
    throw new Error("Download location no longer exists.");
  }
  return location;
}

function markerMatches(marker: LocationMarker | undefined, location: StoredDownloadLocation): boolean {
  return Boolean(
    marker
    && marker.locationId === location.id
    && marker.nonce === location.markerNonce
  );
}

function resolveRequiredPath(path: string): string {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("Choose a download folder.");
  }
  return resolve(path.trim());
}

function equalPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase();
}

async function discoverWindowsDriveRoots(): Promise<string[]> {
  if (process.platform !== "win32") {
    return [];
  }
  const candidates = Array.from({ length: 26 }, (_unused, index) => `${String.fromCharCode(65 + index)}:\\`);
  const availability = await Promise.all(candidates.map(pathExists));
  return candidates.filter((_candidate, index) => availability[index]);
}

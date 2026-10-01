import { useCallback, useState } from "react";
import type { DownloadLocationState } from "../../../core/downloads/DownloadLocations";
import { defaultDownloadLocationId } from "./discoverUtils";
import { formatError } from "../../format";

interface DownloadLocationFeedback {
  onError: (message: string | undefined) => void;
  onNotice: (message: string | undefined) => void;
}

/** Download library state plus the settings actions that add, remove, and reconnect libraries. */
export function useDownloadLocations({ onError, onNotice }: DownloadLocationFeedback) {
  const [downloadLocations, setDownloadLocations] = useState<DownloadLocationState>();
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [locationBusy, setLocationBusy] = useState("");

  const acceptDownloadLocations = useCallback((next: DownloadLocationState): void => {
    setDownloadLocations(next);
    setSelectedLocationId((current) =>
      next.locations.some((location) => location.id === current && location.isAvailable)
        ? current
        : defaultDownloadLocationId(next)
    );
  }, []);

  async function runLocationAction(
    busyKey: string,
    action: () => Promise<DownloadLocationState>,
    successNotice?: (next: DownloadLocationState) => string
  ): Promise<void> {
    setLocationBusy(busyKey);
    onError(undefined);
    try {
      const next = await action();
      acceptDownloadLocations(next);
      if (successNotice) {
        onNotice(successNotice(next));
      }
    } catch (locationError) {
      onError(formatError(locationError));
    } finally {
      setLocationBusy("");
    }
  }

  const addDownloadLocation = (): Promise<void> =>
    runLocationAction("location:add", () => window.subtitleTranslator.addDownloadLocation());

  const setDefaultDownloadLocation = (id: string): Promise<void> =>
    runLocationAction(
      `location:default:${id}`,
      () => window.subtitleTranslator.setDefaultDownloadLocation(id),
      () => "Default download location updated."
    );

  const setDownloadLocationExternal = (id: string, external: boolean): Promise<void> =>
    runLocationAction(
      `location:external:${id}`,
      () => window.subtitleTranslator.setDownloadLocationExternal(id, external),
      () => external
        ? "External-drive identity saved. The library can now be found after its drive letter changes."
        : "Location is now treated as an always-connected library."
    );

  async function removeDownloadLocation(id: string): Promise<void> {
    const location = downloadLocations?.locations.find((item) => item.id === id);
    if (!location || !window.confirm(`Remove ${location.label} from SubsTranslate? No files will be deleted.`)) {
      return;
    }
    await runLocationAction(
      `location:remove:${id}`,
      () => window.subtitleTranslator.removeDownloadLocation(id),
      () => "Download location removed. Its files were left untouched."
    );
  }

  const scanExternalDownloadLocations = (): Promise<void> =>
    runLocationAction(
      "location:scan",
      () => window.subtitleTranslator.scanExternalDownloadLocations(),
      (next) => {
        const availableExternal = next.locations.filter((location) => location.isExternal && location.isAvailable).length;
        return `External-drive search complete. ${availableExternal} external ${availableExternal === 1 ? "library" : "libraries"} available.`;
      }
    );

  const selectedLocation = downloadLocations?.locations.find(
    (location) => location.id === selectedLocationId && location.isAvailable
  );

  return {
    downloadLocations,
    selectedLocationId,
    selectedLocation,
    locationBusy,
    setSelectedLocationId,
    acceptDownloadLocations,
    addDownloadLocation,
    setDefaultDownloadLocation,
    setDownloadLocationExternal,
    removeDownloadLocation,
    scanExternalDownloadLocations
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadProgress } from "../../core/discovery/DiscoveryTypes";

/** Tracks the latest discovery download and whether its floating monitor is minimized. */
export function useDownloadMonitor() {
  const [progress, setProgress] = useState<DownloadProgress>();
  const [collapsed, setCollapsed] = useState(false);
  const activeIdRef = useRef<string>();

  useEffect(() => window.subtitleTranslator.onDiscoveryDownloadProgress((message) => {
    // A new download always opens the monitor, even if the previous one was minimized.
    if (activeIdRef.current !== message.id) {
      activeIdRef.current = message.id;
      setCollapsed(false);
    }
    setProgress(message);
  }), []);

  const dismiss = useCallback(() => {
    activeIdRef.current = undefined;
    setProgress(undefined);
  }, []);

  const cancel = useCallback(() => progress?.method === "torrent"
    ? window.subtitleTranslator.cancelTorrentDownload()
    : window.subtitleTranslator.cancelRealDebridDownload(), [progress?.method]);

  return {
    progress,
    collapsed,
    collapse: useCallback(() => setCollapsed(true), []),
    expand: useCallback(() => setCollapsed(false), []),
    dismiss,
    cancel
  };
}

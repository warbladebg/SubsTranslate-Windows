import { useEffect, useState } from "react";

/**
 * Keeps an overlay mounted for `exitMs` after `open` turns false so it can animate out.
 * While `closing`, callers should hide it from assistive technology and input.
 */
export function useExitPresence(open: boolean, exitMs: number): { present: boolean; closing: boolean } {
  const [lingering, setLingering] = useState(false);

  useEffect(() => {
    if (open) {
      setLingering(true);
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setLingering(false);
      return;
    }
    const timer = window.setTimeout(() => setLingering(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, open]);

  return { present: open || lingering, closing: !open && lingering };
}

/** Spread onto a closing overlay: React 18 has no typed `inert` prop; an empty string sets it. */
export const INERT_PROPS = { inert: "" } as Record<string, string>;

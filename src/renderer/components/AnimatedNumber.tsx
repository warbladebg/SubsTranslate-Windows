import { useEffect, useRef, useState } from "react";
import { formatInteger } from "../format";

interface AnimatedNumberProps {
  value: number;
  /** Defaults to a rounded, locale-grouped integer. */
  format?: (value: number) => string;
  durationMs?: number;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

const formatCount = (value: number) => formatInteger(Math.round(value));

/**
 * Counts from the previously shown value to `value` with an ease-out curve.
 * Assistive technology only ever sees the final formatted value.
 */
export function AnimatedNumber({ value, format = formatCount, durationMs = 750 }: AnimatedNumberProps) {
  const [shown, setShown] = useState(() => prefersReducedMotion() ? value : 0);
  const shownRef = useRef(shown);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value || prefersReducedMotion()) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      shownRef.current = from + (value - from) * eased;
      setShown(shownRef.current);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, value]);

  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

import { useLayoutEffect, useRef } from "react";

const ACTIVE_CHILD = ":scope > .active, :scope > [aria-pressed='true'], :scope > [aria-current='page'], :scope > [aria-selected='true']";

interface SlidingIndicatorProps {
  /** "pill" fills the active segment, "underline" draws a bar beneath it (tabs), "nav" is the sidebar highlight. */
  variant?: "pill" | "underline" | "nav";
}

/**
 * Drop inside a segmented control or tab row to get a highlight that glides to the
 * active child. It watches the group itself, so callers only render it.
 */
export function SlidingIndicator({ variant = "pill" }: SlidingIndicatorProps) {
  const indicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const group = indicator?.parentElement;
    if (!indicator || !group) return;
    group.classList.add("has-sliding-indicator");

    const place = () => {
      const active = group.querySelector<HTMLElement>(ACTIVE_CHILD);
      if (!active || active.offsetWidth === 0) {
        indicator.style.opacity = "0";
        return;
      }
      indicator.style.opacity = "1";
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.height = `${active.offsetHeight}px`;
      indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    };

    place();
    // Enable the glide only after the first placement so it never animates in from 0,0.
    const frame = window.requestAnimationFrame(() => indicator.classList.add("ready"));
    const mutations = new MutationObserver(place);
    mutations.observe(group, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "aria-pressed", "aria-current", "aria-selected"]
    });
    const resizes = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    resizes?.observe(group);

    return () => {
      window.cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes?.disconnect();
      group.classList.remove("has-sliding-indicator");
    };
  }, []);

  return <span aria-hidden="true" className={`sliding-indicator ${variant}`} ref={indicatorRef} />;
}

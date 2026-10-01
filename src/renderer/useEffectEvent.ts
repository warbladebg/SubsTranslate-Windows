import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Returns a stable function that always calls the latest `callback`.
 * Safe to pass to memoized children as an event handler: its identity never changes.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result
): (...args: Args) => Result {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

/**
 * Same mechanism for effects: they can depend on the returned function without
 * re-running whenever the callback's closure changes. Lint treats it as effect-only.
 */
export const useEffectEvent = useStableCallback;

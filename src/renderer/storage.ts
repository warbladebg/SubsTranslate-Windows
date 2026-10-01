import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

// Storage can be blocked or unavailable; preferences then simply last for the session.

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | undefined): void {
  try {
    if (value === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignored: the in-memory value still applies.
  }
}

/** String state that is restored from and written back to localStorage. */
export function useStoredPreference<T extends string>(
  key: string,
  parse: (stored: string | null) => T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => parse(readStorage(key)));
  useEffect(() => writeStorage(key, value), [key, value]);
  return [value, setValue];
}

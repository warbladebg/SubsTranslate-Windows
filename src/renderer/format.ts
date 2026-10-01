import { errorMessage } from "../core/util/errors";

export { fileName, parentDirectory } from "../core/util/paths";

const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i;

/** User-facing message for an error, without Electron's "Error invoking remote method" wrapper. */
export function formatError(error: unknown): string {
  return errorMessage(error).replace(IPC_ERROR_PREFIX, "");
}

const integerFormat = new Intl.NumberFormat();

export function formatInteger(value: number): string {
  return integerFormat.format(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
}

/** Locale date (no time); `fallback` is shown for missing or unparseable values. */
export function formatShortDate(value: string | undefined, fallback = "recently"): string {
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString();
}

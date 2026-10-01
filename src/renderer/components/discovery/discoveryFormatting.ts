export { debridProviderName } from "../../../core/discovery/DiscoveryTypes";

export function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "recently";
  }
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  return minutes < 1 ? "just now" : minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

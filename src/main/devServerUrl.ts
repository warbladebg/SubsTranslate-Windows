export const TRUSTED_DEV_SERVER_URL = "http://127.0.0.1:5173";

export function selectTrustedDevServerUrl(
  configuredUrl: string | undefined,
  isPackaged: boolean
): string | undefined {
  if (isPackaged) {
    return undefined;
  }

  return configuredUrl === TRUSTED_DEV_SERVER_URL || configuredUrl === `${TRUSTED_DEV_SERVER_URL}/`
    ? TRUSTED_DEV_SERVER_URL
    : undefined;
}

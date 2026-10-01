export interface DownloadLocation {
  id: string;
  label: string;
  path: string;
  isExternal: boolean;
  isAvailable: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

export interface DownloadLocationState {
  locations: DownloadLocation[];
  defaultLocationId: string;
  scannedAt: string;
}

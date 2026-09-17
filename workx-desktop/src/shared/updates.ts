export interface UpdateCheckResult {
  status: 'available' | 'up-to-date' | 'unavailable';
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

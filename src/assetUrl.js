const ASSET_BASE = (import.meta.env.VITE_ASSET_BASE_URL || '').replace(/\/$/, '');

export function assetUrl(path) {
  if (!ASSET_BASE || !path) return path;
  return `${ASSET_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

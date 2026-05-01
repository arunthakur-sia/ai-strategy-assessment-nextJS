const rawApiUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')

// API root always points to the backend /api namespace.
// Accept either VITE_API_URL=https://host or https://host/api.
const apiRoot = rawApiUrl
  ? (rawApiUrl.endsWith('/api') ? rawApiUrl : `${rawApiUrl}/api`)
  : '/api'

// API origin is used by streaming fetch calls that build full endpoint URLs.
const apiOrigin = apiRoot.endsWith('/api') ? apiRoot.slice(0, -4) : apiRoot

export const CONFIG = {
  API_URL: apiOrigin,
  API_ROOT: apiRoot,
  APP_NAME: import.meta.env.VITE_APP_NAME || 'SIA Strategy Assessment Agent',
  IS_PRODUCTION: import.meta.env.PROD,
}

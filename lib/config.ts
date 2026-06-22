// Client-side configuration — safe to import from client components
export const CLIENT_CONFIG = {
  APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'SIA Strategy Assessment Agent',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
}

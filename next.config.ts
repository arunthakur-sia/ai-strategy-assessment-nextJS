import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'pdf-parse',
    'pdfkit',
    'pptxgenjs',
    'mammoth',
    'xlsx',
    'bcryptjs',
    'multer',
  ],
  // Allow up to 50 MB request bodies (file uploads)
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
}

export default nextConfig

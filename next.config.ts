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
  // pdf-parse loads pdfjs-dist's worker via a runtime-computed dynamic import,
  // which Vercel's build-time file tracing can't follow statically, so the
  // worker file gets dropped from the deployed function unless listed here.
  outputFileTracingIncludes: {
    '/api/documents/**': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
}

export default nextConfig

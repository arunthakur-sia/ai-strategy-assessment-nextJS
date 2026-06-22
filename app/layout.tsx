import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SIA Strategy Assessment Agent',
  description: 'AI-powered organizational strategy assessment platform',
  icons: { icon: '/favicon-sia.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

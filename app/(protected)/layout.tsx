'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { useStore } from '@/store/useStore'
import AppShell from '@/components/pages/AppShell'

function ProtectedInner({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, project } = useStore()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated || !project) {
      router.replace('/')
    }
  }, [isAuthenticated, project, router])

  if (!isAuthenticated || !project) return null
  return <AppShell>{children}</AppShell>
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProtectedInner>{children}</ProtectedInner>
    </QueryClientProvider>
  )
}

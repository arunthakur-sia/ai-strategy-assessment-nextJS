'use client'
import { useRouter } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Page Not Found</h1>
      <button className="btn btn-primary" onClick={() => router.push('/')}>Go Home</button>
    </div>
  )
}

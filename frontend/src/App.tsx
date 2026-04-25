import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import AppShell from './pages/AppShell'
import { useStore } from './store/useStore'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, project } = useStore()
  if (!isAuthenticated || !project) return <Navigate to="/" replace />
  return <>{children}</>
}

function App() {
  const { setDemoMode } = useStore()

  useEffect(() => {
    fetch('/api/config', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setDemoMode(!!data.demoMode) })
      .catch(() => { setDemoMode(true) })
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app/*" element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

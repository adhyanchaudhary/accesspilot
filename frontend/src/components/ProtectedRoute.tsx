import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PageLoader } from './PageLoader'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <PageLoader label="Verifying your GitHub session" />
  if (status === 'unauthenticated') {
    return <Navigate to="/" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

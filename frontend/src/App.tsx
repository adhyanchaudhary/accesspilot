import { Route, Routes } from 'react-router-dom'
import { ConnectGitHubPanel } from './components/ConnectGitHubPanel'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './context/AuthContext'
import { Dashboard } from './pages/Dashboard'
import { Landing } from './pages/Landing'
import { NotFound } from './pages/NotFound'
import { Results } from './pages/Results'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audits/:jobId"
          element={
            <ProtectedRoute>
              <Results />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <ConnectGitHubPanel />
    </AuthProvider>
  )
}

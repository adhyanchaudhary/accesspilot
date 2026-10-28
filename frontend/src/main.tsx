import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root was not found')

const Preview = import.meta.env.DEV && window.location.pathname === '/dev/audit-preview'
  ? lazy(() => import('./dev/AuditPreview'))
  : null

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      {Preview ? <Suspense fallback={<h1>Loading preview</h1>}><Preview /></Suspense> : <App />}
    </BrowserRouter>
  </StrictMode>,
)

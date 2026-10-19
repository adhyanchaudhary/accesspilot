import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { Layout } from '../components/Layout'

export function NotFound() {
  return (
    <Layout>
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="The page you are looking for does not exist or has moved."
          action={
            <Link to="/" className="btn-primary">
              Back to home
            </Link>
          }
        />
      </div>
    </Layout>
  )
}

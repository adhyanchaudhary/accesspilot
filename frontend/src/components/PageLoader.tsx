import { Spinner } from './Spinner'

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-navy-400">
      <Spinner className="h-7 w-7" />
      <h1 className="text-sm font-medium">{label}</h1>
    </div>
  )
}

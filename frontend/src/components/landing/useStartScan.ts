import { useAuth } from '../../context/AuthContext'

export function useStartScan() {
  const { status, signIn } = useAuth()
  const authed = status === 'authenticated'

  return {
    authed,
    label: authed ? 'Go to dashboard' : 'Start a free scan',
    shortLabel: authed ? 'Dashboard' : 'Start a scan',
    href: authed ? '/dashboard' : undefined,
    onClick: authed ? undefined : signIn,
  }
}

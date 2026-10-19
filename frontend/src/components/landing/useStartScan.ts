import { useAuth } from '../../context/AuthContext'

export function useStartScan() {
  const { status, signIn } = useAuth()
  const authed = status === 'authenticated'

  return {
    authed,
    label: 'Start a scan',
    shortLabel: 'Start a scan',
    href: authed ? '/dashboard#new-audit' : undefined,
    onClick: authed ? undefined : signIn,
  }
}

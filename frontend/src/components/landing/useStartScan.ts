import { useAuth } from '../../context/AuthContext'

export function useStartScan() {
  const { status, openConnect } = useAuth()
  const authed = status === 'authenticated'

  return {
    authed,
    label: 'Start a scan',
    shortLabel: 'Start a scan',
    href: undefined,
    onClick: openConnect,
  }
}

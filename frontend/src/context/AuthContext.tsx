import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, ApiError, isApiError } from '../lib/api'
import type { GitHubUser } from '../lib/types'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  status: AuthStatus
  user: GitHubUser | null
  csrfToken: string | null
  error: string | null
  signIn: () => void
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  /** Called by any screen that receives a 401 so the whole app reacts consistently. */
  expireSession: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [csrfToken, setCsrfToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const session = await api.getSession()
      if (!mounted.current) return
      setUser(session.user)
      setCsrfToken(session.csrf_token)
      setStatus('authenticated')
    } catch (cause) {
      if (!mounted.current) return
      if (isApiError(cause) && cause.isSessionExpired) {
        setUser(null)
        setCsrfToken(null)
        setStatus('unauthenticated')
        return
      }
      setStatus('unauthenticated')
      setError(
        isApiError(cause)
          ? cause.message
          : 'Unable to verify your session. Check that the backend is running.',
      )
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = useCallback(() => {
    // Full-page navigation so the backend can set its OAuth state cookie.
    window.location.assign(api.loginUrl())
  }, [])

  const signOut = useCallback(async () => {
    const token = csrfToken
    setUser(null)
    setCsrfToken(null)
    setStatus('unauthenticated')
    if (!token) return
    try {
      await api.logout(token)
    } catch {
      // Local sign-out already completed; a failed revoke must not trap the user.
    }
  }, [csrfToken])

  const expireSession = useCallback(() => {
    if (!mounted.current) return
    setUser(null)
    setCsrfToken(null)
    setStatus('unauthenticated')
    setError('Your GitHub session expired. Sign in again to continue.')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, csrfToken, error, signIn, signOut, refresh, expireSession }),
    [status, user, csrfToken, error, signIn, signOut, refresh, expireSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

export { ApiError }

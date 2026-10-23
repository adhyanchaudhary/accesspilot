// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { Header } from './components/landing/Header'
import { ConnectGitHubPanel } from './components/ConnectGitHubPanel'
import { api, ApiError } from './lib/api'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {configurable:true, value:function(this: HTMLDialogElement) { this.setAttribute('open','') }})
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {configurable:true, value:function(this: HTMLDialogElement) { this.removeAttribute('open') }})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype,'close') })
function mount() {
  return render(<MemoryRouter><AuthProvider><Routes>
    <Route path="/" element={<Header/>}/>
    <Route path="/dashboard" element={<h1>Choose your repository</h1>}/>
  </Routes><ConnectGitHubPanel/></AuthProvider></MemoryRouter>)
}
const loggedOut = () => vi.spyOn(api,'getSession').mockRejectedValue(new ApiError(401,'Login required'))
it('opens the panel without starting OAuth; only explicit connect starts login', async () => {
  loggedOut()
  const login = vi.spyOn(api,'loginUrl').mockReturnValue('#oauth-test')
  mount()
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getAllByRole('button',{name:'Start a scan'})[0])
  await screen.findByRole('button',{name:'Connect my GitHub'})
  expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe('github-connect-title')
  expect(login).not.toHaveBeenCalled()
  expect(document.body.style.overflow).toBe('hidden')
  fireEvent.click(screen.getByRole('button',{name:'Connect my GitHub'}))
  expect(login).toHaveBeenCalledOnce()
})
it('closes with the close button, restores scrolling and focus', async () => {
  loggedOut()
  mount()
  const start = screen.getAllByRole('button',{name:'Start a scan'})[0]
  start.focus()
  fireEvent.click(start)
  await screen.findByRole('button',{name:'Connect my GitHub'})
  fireEvent.click(screen.getByRole('button',{name:'Close GitHub connection panel'}))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.style.overflow).toBe('')
  expect(document.activeElement).toBe(start)
})
it('closes on native Escape cancel and backdrop click', async () => {
  loggedOut()
  mount()
  fireEvent.click(screen.getAllByRole('button',{name:'Start a scan'})[0])
  await screen.findByRole('button',{name:'Connect my GitHub'})
  fireEvent(screen.getByRole('dialog'), new Event('cancel', {bubbles:false,cancelable:true}))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getAllByRole('button',{name:'Start a scan'})[0])
  fireEvent.click(screen.getByRole('dialog'))
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('shows a restored account and waits for Continue before navigating', async () => {
  vi.spyOn(api,'getSession').mockResolvedValue({user:{id:1,login:'tester'},csrf_token:'csrf'})
  const login = vi.spyOn(api,'loginUrl')
  mount()
  await screen.findAllByRole('link',{name:'Dashboard'})
  fireEvent.click(screen.getAllByRole('button',{name:'Start a scan'})[0])
  expect(screen.getByText('Connected as @tester')).toBeTruthy()
  expect(login).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Continue to dashboard'}))
  expect(screen.getByRole('heading',{name:'Choose your repository'})).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('disconnects with the existing CSRF-protected logout', async () => {
  vi.spyOn(api,'getSession').mockResolvedValue({user:{id:1,login:'tester'},csrf_token:'csrf'})
  const logout = vi.spyOn(api,'logout').mockResolvedValue()
  mount()
  await screen.findAllByRole('link',{name:'Dashboard'})
  fireEvent.click(screen.getAllByRole('button',{name:'Start a scan'})[0])
  fireEvent.click(screen.getByRole('button',{name:'Disconnect'}))
  await screen.findByRole('button',{name:'Connect my GitHub'})
  expect(logout).toHaveBeenCalledWith('csrf')
})
it('keeps the connected account visible when logout fails', async () => {
  vi.spyOn(api,'getSession').mockResolvedValue({user:{id:1,login:'tester'},csrf_token:'csrf'})
  vi.spyOn(api,'logout').mockRejectedValue(new ApiError(503,'Unavailable'))
  mount()
  await screen.findAllByRole('link',{name:'Dashboard'})
  fireEvent.click(screen.getAllByRole('button',{name:'Start a scan'})[0])
  fireEvent.click(screen.getByRole('button',{name:'Disconnect'}))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Sign-out failed'))
  expect(screen.getByText('Connected as @tester')).toBeTruthy()
})

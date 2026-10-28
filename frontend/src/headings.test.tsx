// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { api } from './lib/api'
import { AuditLoadingScreen } from './components/AuditLoadingScreen'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('provides a level-one heading on the bare /audits fallback page', async () => {
  vi.spyOn(api, 'getSession').mockResolvedValue({user:{id:1,login:'demo'},csrf_token:'csrf'})
  render(<MemoryRouter initialEntries={['/audits']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', {level:1,name:'Page not found'})).toBeTruthy()
})
it('provides a heading while verifying an audit session', () => {
  vi.spyOn(api, 'getSession').mockImplementation(() => new Promise(() => {}))
  render(<MemoryRouter initialEntries={['/audits/job-1']}><App /></MemoryRouter>)
  expect(screen.getByRole('heading', {level:1,name:'Verifying your GitHub session'})).toBeTruthy()
})
it('keeps the scan progress heading at level one', () => {
  render(<AuditLoadingScreen job={null} />)
  expect(screen.getByRole('heading', {level:1,name:'Preparing your audit'})).toBeTruthy()
})

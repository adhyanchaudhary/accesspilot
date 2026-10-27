// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api, ApiError } from './lib/api'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Dashboard } from './pages/Dashboard'
import { Results, nextDelay } from './pages/Results'
import { RemediationPanel } from './components/RemediationPanel'
import type { AuditJob } from './lib/types'

const session = { user: { id: 1, login: 'tester' }, csrf_token: 'test-csrf' }
const repo = { id: 7, installation_id: 3, full_name: 'test/accesspilot-demo-store', private: false, default_branch: 'main' }
const job: AuditJob = { job_id: 'job-1', status: 'submitted', summary: { violation_count: 1, affected_element_count: 1 }, error: null, remediation: null, audit: { violations: [] } }
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }) }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe('real API contracts', () => {
  it('includes cookies, CSRF, idempotency and authorized selection for writes', async () => {
    const fetch = vi.fn().mockImplementation(async () => response({ job_id: 'job-1', status: 'queued' }))
    vi.stubGlobal('fetch', fetch)
    await api.submitAudit({ website_url: 'https://accpilot.netlify.app/', repository_id: 7, installation_id: 3 }, 'test-csrf', 'unique-key')
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('http://localhost:8000/audits')
    expect(options.credentials).toBe('include')
    expect(options.headers['X-CSRF-Token']).toBe('test-csrf')
    expect(options.headers['Idempotency-Key']).toBe('unique-key')
    expect(JSON.parse(options.body)).toEqual({ website_url: 'https://accpilot.netlify.app/', repository_id: 7, installation_id: 3 })
    await api.logout('test-csrf')
    expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('test-csrf')
    expect(api.loginUrl()).toContain('/auth/github/login')
  })
  it.each([401,403,409,422,429,502,503])('reports HTTP %s without treating it as success', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ detail: 'Request rejected' }, status)))
    await expect(api.getSession()).rejects.toMatchObject({ status, isSessionExpired: status === 401 })
  })
  it.each([null, {}, {user: {}, csrf_token: ''}])('rejects malformed sessions %j', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)))
    await expect(api.getSession()).rejects.toMatchObject({ status: 502 })
  })
  it('rejects malformed repository lists instead of presenting false empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ repositories: [{}] })))
    await expect(api.listRepositories()).rejects.toMatchObject({ status: 502 })
  })
  it('rejects mismatched job and malicious PR links', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({...job,job_id:'other'})).mockResolvedValueOnce(response({...job,remediation:{status:'completed',pr_url:'javascript:alert(1)'}}))
    vi.stubGlobal('fetch',fetch)
    await expect(api.getAudit('job-1')).rejects.toMatchObject({status:502})
    await expect(api.getAudit('job-1')).rejects.toMatchObject({status:502})
  })
})

function AuthProbe() { const a = useAuth(); return <div>{a.status}:{a.user?.login}:{a.csrfToken}<button onClick={a.expireSession}>Expire</button></div> }
it('loads actual session/CSRF and clears auth on expiration', async () => {
  vi.spyOn(api,'getSession').mockResolvedValue(session)
  render(<AuthProvider><AuthProbe/></AuthProvider>)
  await screen.findByText('authenticated:tester:test-csrf')
  fireEvent.click(screen.getByText('Expire'))
  expect(screen.getByText('unauthenticated::')).toBeTruthy()
})
it('selects only backend repositories and submits selected IDs', async () => {
  vi.spyOn(api,'getSession').mockResolvedValue(session)
  vi.spyOn(api,'listRepositories').mockResolvedValue([repo])
  vi.spyOn(api,'health').mockResolvedValue({status:'ok'})
  vi.spyOn(api,'githubHealth').mockResolvedValue({status:'ok'})
  const submit = vi.spyOn(api,'submitAudit').mockResolvedValue({job_id:'job-1',status:'queued'})
  render(<MemoryRouter><AuthProvider><Dashboard/></AuthProvider></MemoryRouter>)
  await screen.findByText(repo.full_name)
  const input = screen.getByLabelText(/website url/i)
  fireEvent.change(input,{target:{value:'https://accpilot.netlify.app/'}})
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(submit).toHaveBeenCalledWith({website_url:'https://accpilot.netlify.app/',installation_id:3,repository_id:7},'test-csrf',expect.any(String)))
})
it('keeps submitted separate from completion and renders only confirmed PR link', () => {
  const {rerender} = render(<RemediationPanel remediation={null} status="submitted"/>)
  expect(screen.queryByRole('link')).toBeNull()
  expect(nextDelay(job)).toBe(8000)
  const completed = {status:'completed' as const, branch:'accesspilot/remediation-job-1',commit_sha:'a'.repeat(40),pr_url:'https://github.com/test/site/pull/1'}
  rerender(<RemediationPanel remediation={completed} status="submitted"/>)
  expect(screen.getByRole('link').getAttribute('href')).toBe(completed.pr_url)
  expect(nextDelay({...job,remediation:completed})).toBeNull()
  rerender(<RemediationPanel remediation={{status:'failed',error:'conflict'}} status="submitted"/>)
  expect(screen.getByRole('alert').textContent).toContain('could not confirm')
  expect(nextDelay({...job,remediation:{status:'failed'}})).toBeNull()
})
it('polls real job data and renders violation evidence as text', async () => {
  vi.spyOn(api,'getSession').mockResolvedValue(session)
  vi.spyOn(api,'getAudit').mockResolvedValue({...job,audit:{violations:[{id:'image-alt',description:'Image lacks alt',impact:'serious',nodes:[{html:'<img src=x>',target:['img']}]}]}})
  render(<MemoryRouter initialEntries={['/audits/job-1']}><AuthProvider><Routes><Route path="/audits/:jobId" element={<Results/>}/></Routes></AuthProvider></MemoryRouter>)
  await screen.findByText('Image lacks alt')
  expect(screen.getByText('<img src=x>')).toBeTruthy()
  expect(document.querySelector('img[src=x]')).toBeNull()
  expect(api.getAudit).toHaveBeenCalledWith('job-1',expect.any(AbortSignal))
})
it('renders job fetch errors without invented data', async () => {
  vi.spyOn(api,'getSession').mockResolvedValue(session)
  vi.spyOn(api,'getAudit').mockRejectedValue(new ApiError(503,'Service unavailable'))
  render(<MemoryRouter initialEntries={['/audits/job-1']}><AuthProvider><Routes><Route path="/audits/:jobId" element={<Results/>}/></Routes></AuthProvider></MemoryRouter>)
  await screen.findByText('Service unavailable', {}, {timeout: 7000})
  expect(api.getAudit).toHaveBeenCalledTimes(3)
}, 10000)

it('loads confirmed remediation through the polling API contract', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({...job,remediation:{status:'completed',branch:'accesspilot/remediation-job-1',commit_sha:'a'.repeat(40),pr_url:'https://github.com/test/site/pull/1'}})))
  const data = await api.getAudit('job-1')
  expect(data.remediation?.status).toBe('completed')
  expect(nextDelay(data)).toBeNull()
})
it.each([{...job,summary:{}},{...job,audit:{violations:[{}]}}])('rejects malformed evidence/count data', async data => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)))
  await expect(api.getAudit('job-1')).rejects.toMatchObject({status:502})
})

it('shows terminal no-change outcomes without waiting for a PR', () => {
  render(<RemediationPanel remediation={{status:'no_changes',reason:'no_violations'}} status="completed" />)
  expect(screen.getByText(/No automatically detectable violations found/)).toBeTruthy()
  expect(nextDelay({...job,status:'completed',remediation:{status:'no_changes',reason:'no_violations'}})).toBeNull()
  expect(nextDelay({...job,remediation:{status:'no_changes',reason:'no_candidate_files'}})).toBeNull()
})

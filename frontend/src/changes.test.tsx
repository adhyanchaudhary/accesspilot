// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthProvider } from './context/AuthContext'
import { ChangesViewer } from './components/ChangesViewer'
import { api, ApiError } from './lib/api'
import type { AuditJob, AuditChanges, FileDiff } from './lib/types'

const file: FileDiff = {
  file_path: 'src/App.tsx', status: 'available', reason: null, additions: 1, deletions: 1,
  old_blob_sha: 'c'.repeat(40), new_blob_sha: 'd'.repeat(40), issue_ids: ['image-alt'],
  hunks: [{old_start: 1, old_count: 1, new_start: 1, new_count: 1, lines: [
    {kind: 'delete', old_line: 1, new_line: null, text: '<img src="hero.png"/>', ending:'lf'},
    {kind: 'add', old_line: null, new_line: 1, text: '<img src="hero.png" alt="Store entrance"/>', ending:'none'},
  ]}],
}
const changes: AuditChanges = {job_id:'job-1',status:'completed',reason:null,base_sha:'a'.repeat(40),commit_sha:'b'.repeat(40),branch:'accesspilot/remediation-job-1',files:[file]}
const job: AuditJob = {job_id:'job-1',status:'submitted',error:null,summary:null,audit:null,
  remediation:{status:'completed',commit_sha:'b'.repeat(40),branch:changes.branch,pr_url:'https://github.com/demo/store/pull/1'}}
const clone = () => JSON.parse(JSON.stringify(changes)) as AuditChanges
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
function mount(input=job) {
  vi.spyOn(api,'getSession').mockResolvedValue({user:{id:1,login:'demo'},csrf_token:'csrf'})
  return render(<AuthProvider><ChangesViewer job={input}/></AuthProvider>)
}
it('renders additions/deletions, line numbers and source as text, never HTML', async () => {
  vi.spyOn(api,'getAuditChanges').mockResolvedValue(clone())
  mount()
  await screen.findByRole('region',{name:'Code diff for src/App.tsx'})
  expect(screen.getByText('<img src="hero.png" alt="Store entrance"/>')).toBeTruthy()
  expect(document.querySelector('img[src="hero.png"]')).toBeNull()
  expect(screen.getByText('No newline at end of file')).toBeTruthy()
  expect(screen.getByText('Added')).toBeTruthy()
  expect(screen.getByText('Deleted')).toBeTruthy()
  expect(screen.getByRole('link',{name:'Open draft PR'}).getAttribute('href')).toBe(job.remediation?.pr_url)
})
it('switches files and does not refetch on an identical status poll', async () => {
  const data=clone()
  data.files.push({...file,file_path:'src/style.css'})
  const get=vi.spyOn(api,'getAuditChanges').mockResolvedValue(data)
  const view=mount()
  await screen.findByRole('region',{name:'Code diff for src/App.tsx'})
  fireEvent.click(screen.getByRole('button',{name:/src\/style.css/}))
  expect(screen.getByRole('region',{name:'Code diff for src/style.css'})).toBeTruthy()
  view.rerender(<AuthProvider><ChangesViewer job={{...job}}/></AuthProvider>)
  expect(get).toHaveBeenCalledTimes(1)
})
it('waits for confirmed remediation without requesting a machine endpoint', () => {
  const get=vi.spyOn(api,'getAuditChanges')
  mount({...job,remediation:null})
  expect(screen.getByText('Waiting for confirmed changes')).toBeTruthy()
  expect(screen.queryByRole('region',{name:/^Code diff for/})).toBeNull()
  expect(get).not.toHaveBeenCalled()
})
it('rejects a preview for a different commit', async () => {
  vi.spyOn(api,'getAuditChanges').mockResolvedValue({...clone(),commit_sha:'f'.repeat(40)})
  mount()
  expect(await screen.findByText('Preview commit does not match this audit.')).toBeTruthy()
  expect(screen.queryByRole('region',{name:/^Code diff for/})).toBeNull()
})
it('handles unavailable previews without inventing zero counts', async () => {
  const data=clone()
  data.files=[{file_path:'src/big.ts',status:'unavailable',reason:'preview_limit',issue_ids:[],hunks:[],additions:null,deletions:null}]
  vi.spyOn(api,'getAuditChanges').mockResolvedValue(data)
  mount()
  await screen.findByText('Preview unavailable for this file')
  expect(screen.getByText('Counts unavailable')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByRole('link',{name:'Open draft PR'})).toBeTruthy()
})
it('retries preview errors without rerunning remediation', async () => {
  const get=vi.spyOn(api,'getAuditChanges').mockRejectedValueOnce(new ApiError(503,'Try later')).mockResolvedValueOnce(clone())
  mount()
  await screen.findByText('Try later')
  fireEvent.click(screen.getByRole('button',{name:'Retry preview'}))
  await screen.findByRole('region',{name:/^Code diff for/})
  expect(get).toHaveBeenCalledTimes(2)
})
it('copies only the selected visible patch and preserves newline markers', async () => {
  vi.spyOn(api,'getAuditChanges').mockResolvedValue(clone())
  const writeText=vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})
  mount()
  await screen.findByRole('region',{name:/^Code diff for/})
  fireEvent.click(screen.getByRole('button',{name:'Copy visible patch'}))
  await screen.findByText('Copied')
  expect(writeText.mock.calls[0][0]).toContain('--- a/src/App.tsx')
  expect(writeText.mock.calls[0][0]).toContain('\\ No newline at end of file')
})
it.each([401,403,404,502])('propagates protected preview HTTP %s', async status => {
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'Denied'}),{status}))
  vi.stubGlobal('fetch',fetch)
  await expect(api.getAuditChanges('job-1')).rejects.toMatchObject({status})
  expect(fetch.mock.calls[0][1].credentials).toBe('include')
  expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
})
it.each(['job','commit','counts','lines','html-object','empty'])('rejects malformed preview: %s', async kind => {
  const data=clone()
  if(kind==='job') data.job_id='other'
  if(kind==='commit') data.commit_sha='bad'
  if(kind==='counts') data.files[0].additions=999
  if(kind==='lines') data.files[0].hunks[0].lines[0].old_line=null
  if(kind==='html-object') (data.files[0].hunks[0].lines[0] as unknown as Record<string,unknown>).text={html:'bad'}
  if(kind==='empty') data.files=[]
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(data),{status:200})))
  await expect(api.getAuditChanges('job-1')).rejects.toMatchObject({status:502})
})
it('uses the browser changes endpoint and validates the real response shape', async () => {
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(changes),{status:200}))
  vi.stubGlobal('fetch',fetch)
  expect(await api.getAuditChanges('job-1')).toEqual(changes)
  expect(fetch.mock.calls[0][0]).toContain('/audits/job-1/changes')
})
it('clears a previous preview when navigating to a different job', async () => {
  const get=vi.spyOn(api,'getAuditChanges').mockResolvedValue(clone())
  const view=mount()
  await screen.findByRole('region',{name:/^Code diff for/})
  view.rerender(<AuthProvider><ChangesViewer job={{...job,job_id:'job-2',remediation:null}}/></AuthProvider>)
  await waitFor(()=>expect(screen.queryByRole('region',{name:/^Code diff for/})).toBeNull())
  expect(get).toHaveBeenCalledTimes(1)
})
it('explains only the selected changed file and falls back to original findings', async () => {
  const data = clone()
  data.files.push({...file, file_path:'src/other.tsx', issue_ids:['custom-rule']})
  vi.spyOn(api,'getAuditChanges').mockResolvedValue(data)
  mount({...job, audit:{violations:[{id:'custom-rule',description:'Original custom finding',impact:null,nodes:[]}]}})
  await screen.findByText('An image needs a description')
  expect(screen.getByText('Proposed fixes · Not yet verified by a new scan')).toBeTruthy()
  expect(screen.queryByText('Original custom finding')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:/src\/other.tsx/}))
  expect(screen.queryByText('An image needs a description')).toBeNull()
  expect(screen.getByText('Accessibility issue needs review')).toBeTruthy()
  expect(screen.getByText('Original finding: Original custom finding')).toBeTruthy()
})

import { Check, ChevronDown, Github, Lock, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Repository } from '../lib/types'

export function RepositoryPicker({ repositories, selected, onSelect }: {
  repositories: Repository[]
  selected: Repository | null
  onSelect: (repo: Repository) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const matches = repositories.filter(repo => repo.full_name.toLowerCase().includes(query.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  return <div ref={container} className="relative min-w-0" onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    <button ref={trigger} type="button" id="repository" aria-expanded={open}
      aria-controls="repository-options" onClick={() => { setQuery(''); setOpen(value => !value) }}
      className="input flex w-full items-center gap-3 text-left hover:border-brand-400">
      <Github className="h-5 w-5 shrink-0 text-navy-400" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{selected?.full_name ?? 'Choose a repository'}</span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-navy-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
    {open && <div id="repository-options" className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-navy-200 bg-white shadow-xl">
      <div className="relative border-b border-navy-100 p-3">
        <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" aria-hidden="true" />
        <input autoFocus type="search" aria-label="Search repositories" placeholder="Search your repositories…"
          value={query} onChange={event => setQuery(event.target.value)} className="input pl-10" />
      </div>
      <div role="group" aria-label="Authorized repositories" className="max-h-64 overflow-y-auto p-1.5">
        {matches.map(repo => <button key={repo.id} type="button" aria-pressed={selected?.id === repo.id}
          onClick={() => { onSelect(repo); setOpen(false); trigger.current?.focus() }}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-brand-50 focus-visible:bg-brand-50 ${selected?.id === repo.id ? 'bg-brand-50 text-brand-700' : 'text-navy-800'}`}>
          <span className="min-w-0 flex-1"><span className="block break-all text-sm font-semibold">{repo.full_name}</span>
            <span className="mt-1 flex items-center gap-1 text-xs text-navy-500">{repo.private && <Lock className="h-3 w-3" aria-hidden="true" />}{repo.private ? 'Private' : 'Public'} · {repo.default_branch}</span>
          </span>
          {selected?.id === repo.id && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
        </button>)}
        {matches.length === 0 && <p className="px-3 py-6 text-center text-sm text-navy-500" role="status">No repositories match “{query}”.</p>}
      </div>
    </div>}
  </div>
}

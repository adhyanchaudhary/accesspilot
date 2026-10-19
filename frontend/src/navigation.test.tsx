// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RepositoryPicker } from './components/RepositoryPicker'
import { Features } from './components/landing/Features'
import { Header } from './components/landing/Header'
import { AuthProvider } from './context/AuthContext'
import { api } from './lib/api'

const repos = [
  {id: 1, installation_id: 10, full_name:'demo/store',private:false,default_branch:'main'},
  {id: 2, installation_id: 20, full_name:'demo/private-site',private:true,default_branch:'develop'},
]
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
it('searches authorized repositories, selects exact repository and closes', () => {
  const select = vi.fn()
  render(<RepositoryPicker repositories={repos} selected={repos[0]} onSelect={select}/>)
  fireEvent.click(screen.getByRole('button', {name:'demo/store'}))
  fireEvent.change(screen.getByRole('searchbox'), {target:{value:'private'}})
  fireEvent.click(screen.getByRole('button', {name:/demo\/private-site/}))
  expect(select).toHaveBeenCalledWith(repos[1])
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(document.activeElement?.id).toBe('repository')
})
it('shows empty search and dismisses with Escape without changing selection', () => {
  const select = vi.fn()
  render(<RepositoryPicker repositories={repos} selected={repos[0]} onSelect={select}/>)
  fireEvent.click(screen.getByRole('button'))
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'missing'}})
  expect(screen.getByRole('status').textContent).toContain('No repositories match')
  fireEvent.keyDown(screen.getByRole('searchbox'),{key:'Escape'})
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(select).not.toHaveBeenCalled()
})
it('keeps Dashboard navigation separate from Start a scan', async () => {
  vi.spyOn(api,'getSession').mockResolvedValue({user:{id:1,login:'tester'},csrf_token:'csrf'})
  render(<MemoryRouter><AuthProvider><Header/></AuthProvider></MemoryRouter>)
  const dashboard = await screen.findAllByRole('link',{name:'Dashboard'})
  expect(dashboard[0].getAttribute('href')).toBe('/dashboard')
  expect(screen.getAllByRole('link',{name:'Start a scan'})[0].getAttribute('href')).toBe('/dashboard#new-audit')
})
it('spins cards with the button and preserves pause after hovering', () => {
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(600)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const {container} = render(<Features/>)
  const stage = screen.getByRole('group')
  const card = container.querySelector<HTMLElement>('[data-ring-card]')!
  fireEvent.click(screen.getByRole('button',{name:'Pause rotation'}))
  fireEvent.mouseEnter(stage)
  fireEvent.mouseLeave(stage)
  expect(screen.getByRole('button',{name:'Resume rotation'}).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button',{name:'Spin feature cards'}))
  const position = card.style.transform
  expect(position).toContain('translate3d')
  fireEvent.keyDown(window,{key:'ArrowRight'})
  expect(card.style.transform).toBe(position)
  fireEvent.keyDown(stage,{key:'ArrowRight'})
  expect(card.style.transform).not.toBe(position)
})

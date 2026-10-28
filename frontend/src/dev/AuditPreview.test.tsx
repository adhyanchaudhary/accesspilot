// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AuditPreview from './AuditPreview'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('renders sample changes and switches states without network requests', async () => {
  const fetch = vi.fn(() => { throw new Error('Preview must not request the network') })
  vi.stubGlobal('fetch', fetch)
  render(<AuditPreview />)
  await screen.findByRole('region', {name: 'Code diff for src/Hero.jsx'})
  fireEvent.click(screen.getByRole('button', {name: /src\/Cart.jsx/}))
  expect(screen.getByRole('region', {name: 'Code diff for src/Cart.jsx'})).toBeTruthy()
  for (const state of ['no_changes', 'failed', 'pending']) {
    fireEvent.change(screen.getByRole('combobox', {name: 'Preview state'}), {target: {value: state}})
    expect(screen.queryByRole('region', {name: /^Code diff/})).toBeNull()
  }
  expect(fetch).not.toHaveBeenCalled()
})

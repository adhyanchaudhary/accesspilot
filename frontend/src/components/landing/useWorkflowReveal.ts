import { useEffect, useRef, useState } from 'react'

/** One-shot entrances; a separate reading band tracks the current step both ways. */
export function useWorkflowReveal() {
  const listRef = useRef<HTMLOListElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set())
  const [active, setActive] = useState(0)

  useEffect(() => {
    const list = listRef.current
    if (!list || !('IntersectionObserver' in window)) return
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-workflow-step]'))
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let entrances: IntersectionObserver | undefined

    const updateMotion = () => {
      entrances?.disconnect()
      if (media?.matches) {
        setEnabled(false)
        return
      }
      setEnabled(true)
      entrances = new IntersectionObserver(entries => {
        const incoming = entries.filter(entry => entry.isIntersecting)
        if (!incoming.length) return
        setRevealed(previous => {
          const next = new Set(previous)
          incoming.forEach(entry => next.add(Number((entry.target as HTMLElement).dataset.workflowStep)))
          return next
        })
        incoming.forEach(entry => entrances?.unobserve(entry.target))
      }, { rootMargin: '0px 0px -10% 0px', threshold: 0.16 })
      cards.forEach(card => entrances?.observe(card))
    }

    const reading = new IntersectionObserver(entries => {
      // Measure only on crossings, not on every scroll frame.
      if (!entries.some(entry => entry.isIntersecting)) return
      const band = window.innerHeight * 0.45
      const nearest = cards.reduce((best, card, index) => {
        const rect = card.getBoundingClientRect()
        const distance = Math.abs(rect.top + rect.height / 2 - band)
        return distance < best.distance ? { index, distance } : best
      }, { index: 0, distance: Infinity })
      setActive(nearest.index)
    }, { rootMargin: '-30% 0px -40% 0px', threshold: 0 })

    updateMotion()
    cards.forEach(card => reading.observe(card))
    media?.addEventListener('change', updateMotion)
    return () => {
      entrances?.disconnect()
      reading.disconnect()
      media?.removeEventListener('change', updateMotion)
    }
  }, [])

  return { listRef, enabled, revealed, active }
}

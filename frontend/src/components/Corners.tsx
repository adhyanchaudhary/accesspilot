/**
 * Blue corner brackets drawn inside a relatively-positioned card, matching the
 * technical "scanner" aesthetic of the design reference.
 */
export function Corners() {
  const common = 'absolute h-3 w-3 border-brand-500/50'
  return (
    <div className="pointer-events-none absolute inset-2.5 z-10 rounded-xl" aria-hidden="true">
      <span className={`${common} left-0 top-0 border-l-[1.5px] border-t-[1.5px]`} />
      <span className={`${common} right-0 top-0 border-r-[1.5px] border-t-[1.5px]`} />
      <span className={`${common} bottom-0 left-0 border-b-[1.5px] border-l-[1.5px]`} />
      <span className={`${common} bottom-0 right-0 border-b-[1.5px] border-r-[1.5px]`} />
    </div>
  )
}

/**
 * Fixed decorative backdrop: soft gradient blobs behind the app.
 * Purely presentational and hidden from assistive technology.
 */
export function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,#7fb0ff,transparent_68%)] opacity-60 blur-3xl" />
      <div className="absolute -bottom-44 -left-36 h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,#a9c6ff,transparent_68%)] opacity-60 blur-3xl" />
      <div className="absolute left-1/2 top-1/3 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,#c8f0ff,transparent_70%)] opacity-40 blur-3xl" />
    </div>
  )
}

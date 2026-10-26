import { Link } from 'react-router-dom'

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link
      to={to}
      className="inline-flex shrink-0 items-center"
      aria-label="AccessPilot home"
    >
      <img
        src="/accesspilot-logo.png"
        alt="AccessPilot"
        width={708}
        height={169}
        className="h-auto w-[128px] sm:w-[168px] lg:w-[190px]"
      />
    </Link>
  )
}

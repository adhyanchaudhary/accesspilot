import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  children: ReactNode
}

export default function Link({ href, children, ...rest }: LinkProps) {
  if (href.startsWith('/')) {
    return (
      <RouterLink to={href} {...rest}>
        {children}
      </RouterLink>
    )
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export function redirectsFor(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Set BACKEND_URL in Netlify build environment settings.')
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('BACKEND_URL must be an HTTPS origin without credentials or a path.')
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.port ||
      !/^[a-z0-9.-]+$/.test(url.hostname) || !url.hostname.includes('.')) {
    throw new Error('BACKEND_URL must be an HTTPS origin without credentials or a path.')
  }
  // Netlify processes these in order. Never send API requests to the SPA fallback.
  return `/api/* ${url.origin}/:splat 200!\n/* /index.html 200\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = new URL('../dist/_redirects', import.meta.url)
  writeFileSync(output, redirectsFor(process.env.BACKEND_URL))
  console.log('Generated Netlify API proxy and SPA redirects.')
}

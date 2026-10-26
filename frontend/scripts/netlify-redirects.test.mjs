import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redirectsFor } from './netlify-redirects.mjs'

test('proxy strips /api and precedes SPA fallback', () => {
  assert.equal(redirectsFor('https://backend.example.com/'),
    '/api/* https://backend.example.com/:splat 200!\n/* /index.html 200\n')
})

test('missing or unsafe configuration fails without echoing the value', () => {
  for (const value of [undefined, '', 'http://backend.example.com',
    'https://user:secret@backend.example.com', 'https://backend.example.com/api',
    'https://backend.example.com/?token=secret', 'https://backend.example.com/#secret',
    'https://backend.example.com:9000', 'https://backend.example.com/\n/* /bad 200']) {
    assert.throws(() => redirectsFor(value), error =>
      !error.message.includes('secret') && error.message.includes('BACKEND_URL'))
  }
})

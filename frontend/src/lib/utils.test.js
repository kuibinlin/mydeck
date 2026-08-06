// uid() exists for one reason, so that reason is what gets tested.
//
// crypto.randomUUID is a secure-context API. Over https or on localhost it is
// there; opened as http://192.168.x.x:5173 — which is how the app is reached
// when testing on a phone on the same wifi — `crypto` exists but `randomUUID`
// does not. Calling it is a TypeError, not a silent undefined, so the first
// render that needs an id takes the whole page down. That is the exact
// condition simulated below.

import { describe, it, expect, afterEach } from 'vitest'
import { uid } from './utils'

const real = globalThis.crypto

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: real,
    configurable: true,
    writable: true,
  })
})

const setCrypto = (value) =>
  Object.defineProperty(globalThis, 'crypto', {
    value,
    configurable: true,
    writable: true,
  })

describe('uid', () => {
  it('uses crypto.randomUUID when the page is a secure context', () => {
    setCrypto({ randomUUID: () => 'fixed-uuid' })
    expect(uid()).toBe('fixed-uuid')
  })

  it('does not throw when randomUUID is missing — the LAN-over-http case', () => {
    setCrypto({})
    expect(() => uid()).not.toThrow()
    expect(typeof uid()).toBe('string')
  })

  it('does not throw when crypto itself is missing', () => {
    setCrypto(undefined)
    expect(() => uid()).not.toThrow()
    expect(uid().length).toBeGreaterThan(0)
  })

  it('stays unique in the fallback, including within the same millisecond', () => {
    setCrypto({})
    const ids = Array.from({ length: 500 }, () => uid())
    expect(new Set(ids).size).toBe(500)
  })

  it('is safe as a React key — never empty', () => {
    setCrypto({})
    expect(uid().trim()).not.toBe('')
  })
})

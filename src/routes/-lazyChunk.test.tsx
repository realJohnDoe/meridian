// @vitest-environment jsdom
import { Suspense } from 'react'
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { lazyChunk } from './-lazyChunk'

describe('lazyChunk', () => {
  it('keeps the Suspense fallback up when the chunk fails to load, instead of throwing to the error boundary', async () => {
    const Stale = lazyChunk<object>(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    render(<Suspense fallback={<p>loading</p>}><Stale /></Suspense>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('renders the loaded component', async () => {
    const Ok = lazyChunk(() => Promise.resolve(() => <p>loaded</p>))
    render(<Suspense fallback={<p>loading</p>}><Ok /></Suspense>)
    expect(await screen.findByText('loaded')).toBeInTheDocument()
  })
})

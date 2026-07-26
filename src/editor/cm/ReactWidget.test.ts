// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { ReactWidget } from './ReactWidget'

/** Minimal concrete widget; each test overrides only what it needs. */
class TestWidget extends ReactWidget {
  constructor(
    private readonly node: ReactNode = 'content',
    private readonly overrides: {
      className?: string
      inline?: boolean
      style?: Partial<CSSStyleDeclaration>
    } = {},
  ) { super() }

  renderReact(): ReactNode { return this.node }
  protected override get domClassName(): string { return this.overrides.className ?? '' }
  protected override get inline(): boolean { return this.overrides.inline ?? false }
  protected override get containerStyle(): Partial<CSSStyleDeclaration> {
    return this.overrides.style ?? {}
  }
}

/** `createRoot().render()` is async, so mounting has to run inside `act`. */
async function mount(widget: ReactWidget): Promise<HTMLElement> {
  let el!: HTMLElement
  await act(async () => {
    el = widget.toDOM()
    // `render()` only schedules the initial render; yielding a microtask inside
    // `act` lets it commit before the caller inspects the DOM.
    await Promise.resolve()
  })
  return el
}

/** Let the deferred `setTimeout(…, 0)` unmount in `destroy` run. */
async function flushDestroy(widget: ReactWidget, el: HTMLElement): Promise<void> {
  await act(async () => {
    widget.destroy(el)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('ReactWidget.toDOM', () => {
  it('renders into a block div by default', async () => {
    const el = await mount(new TestWidget())

    expect(el.tagName).toBe('DIV')
    expect(el.textContent).toBe('content')
    // Reset so a list item's hanging indent (cm-ul-item sets -1.2em) doesn't
    // shift the widget content.
    expect(el.style.textIndent).toBe('0px')
    // Only inline widgets override line-height.
    expect(el.style.lineHeight).toBe('')
    expect(el.className).toBe('')
  })

  it('renders into a span with a reset line-height when inline', async () => {
    const el = await mount(new TestWidget('chip', { inline: true }))

    expect(el.tagName).toBe('SPAN')
    // The editor's tall 1.85 line-height would stretch a chip.
    expect(el.style.lineHeight).toBe('1.5')
    expect(el.style.textIndent).toBe('0px')
  })

  it('applies the subclass class name', async () => {
    const el = await mount(new TestWidget('x', { className: 'cm-my-widget' }))
    expect(el.className).toBe('cm-my-widget')
  })

  it('applies per-instance container styles', async () => {
    const el = await mount(new TestWidget('x', { style: { opacity: '0.5' } }))
    expect(el.style.opacity).toBe('0.5')
  })

  it('lets container styles override the text-indent reset', async () => {
    // containerStyle is assigned last, so a subclass can opt out.
    const el = await mount(new TestWidget('x', { style: { textIndent: '2em' } }))
    expect(el.style.textIndent).toBe('2em')
  })

  it('renders real React elements, not just text', async () => {
    const el = await mount(
      new TestWidget(createElement('button', { type: 'button' }, 'Toggle')),
    )
    const button = el.querySelector('button')
    expect(button).not.toBeNull()
    expect(button!.textContent).toBe('Toggle')
  })
})

describe('ReactWidget.destroy', () => {
  it('unmounts the React root and empties the container', async () => {
    const widget = new TestWidget()
    const el = await mount(widget)
    expect(el.textContent).toBe('content')

    await flushDestroy(widget, el)
    expect(el.textContent).toBe('')
  })

  it('is a no-op when called twice for the same element', async () => {
    const widget = new TestWidget()
    const el = await mount(widget)

    await flushDestroy(widget, el)
    // The root is dropped from the registry on the first call, so a second
    // destroy must not try to unmount it again.
    await expect(flushDestroy(widget, el)).resolves.toBeUndefined()
  })

  it('is a no-op for an element that was never mounted', async () => {
    const widget = new TestWidget()
    const stray = document.createElement('div')
    await expect(flushDestroy(widget, stray)).resolves.toBeUndefined()
  })

  it('keeps other widget instances mounted', async () => {
    const first = new TestWidget('first')
    const second = new TestWidget('second')
    const firstEl = await mount(first)
    const secondEl = await mount(second)

    await flushDestroy(first, firstEl)

    // Roots are tracked per element, so tearing one down leaves the other be.
    expect(firstEl.textContent).toBe('')
    expect(secondEl.textContent).toBe('second')
  })
})

describe('ReactWidget.ignoreEvent', () => {
  it('tells CM6 to leave events inside the widget alone', () => {
    // React handlers own all interaction; without this CM6's mousedown places
    // the cursor and the widget disappears before they can fire.
    expect(new TestWidget().ignoreEvent()).toBe(true)
  })
})

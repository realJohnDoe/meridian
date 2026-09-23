// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import WikilinkPopup from './WikilinkPopup'
import { setupStore, makeRoots, TEST_VAULT } from '@/test-utils'

setupStore()

describe('WikilinkPopup', () => {
  // A stored ref must survive the target being renamed later — resolveWikilink
  // matches on fileSlug first, which titleToSlug never touches after an entry
  // is created, whereas a title changes any time the user edits it. Writing
  // the title into the file would silently break the link on the next rename;
  // fileOccurrence.ts's FilePickerEntry doc comment states this is why the
  // slug exists.
  it('inserts the target fileSlug, not its title, so a later rename cannot break the link', () => {
    const roots = makeRoots('project-alpha', { title: 'Project Alpha' })
    const view = new EditorView({ doc: '[[', selection: { anchor: 2 } })

    render(
      <WikilinkPopup
        popup={{ query: '', from: 0, coords: { top: 100, bottom: 120, left: 50, right: 50 } }}
        roots={roots}
        vaultId={TEST_VAULT}
        view={view}
        onClose={() => {}}
      />,
    )

    fireEvent.mouseDown(screen.getByRole('option', { name: 'Project Alpha' }))

    expect(view.state.doc.toString()).toBe('[[project-alpha]]')
  })
})

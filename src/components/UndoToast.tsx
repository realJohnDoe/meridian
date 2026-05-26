import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'

/**
 * Renders the undo-delete toast driven by store.toast.
 * Animates in when a toast appears and fades out when it clears.
 */
export default function UndoToast() {
  const toast = useStore(s => s.toast)
  const setToast = useStore(s => s.setToast)

  // Keep a snapshot of the last non-null toast so we can still render
  // its text while the fade-out animation plays.
  const [visible, setVisible] = useState(false)
  const [hiding, setHiding] = useState(false)
  const snapshotRef = useRef<{ title: string; onUndo: () => void } | null>(null)
  // Track visible in a ref so the effect dep array only reacts to toast changes,
  // not to the visible state it sets (which would cause a double-fire).
  const visibleRef = useRef(false)

  // useLayoutEffect (not useEffect) so the show-state update is batched into the
  // same paint as the store update — useEffect would fire after the browser has
  // already painted a frame with visible=false, causing a visible one-frame delay.
  useLayoutEffect(() => {
    if (toast) {
      snapshotRef.current = toast
      setHiding(false)
      setVisible(true)
      visibleRef.current = true
    } else if (visibleRef.current) {
      visibleRef.current = false
      setHiding(true)
      const id = setTimeout(() => {
        setVisible(false)
        setHiding(false)
      }, 280)
      return () => clearTimeout(id)
    }
  }, [toast]) // only react to toast changes, not to the visible state we set

  if (!visible) return null

  const snap = snapshotRef.current!

  return (
    <div className={`undo-toast${hiding ? ' hiding' : ''}`}>
      <span className="undo-toast-msg">
        Deleted: <strong>{snap.title}</strong>
      </span>
      <button
        className="undo-btn"
        onClick={() => {
          snap.onUndo()
          setToast(null)
        }}
      >
        Undo
      </button>
    </div>
  )
}

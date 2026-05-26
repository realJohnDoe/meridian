import { useEffect, useRef, useState } from 'react'
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

  useEffect(() => {
    if (toast) {
      // New toast: capture snapshot, show immediately.
      snapshotRef.current = toast
      setHiding(false)
      setVisible(true)
    } else if (visible) {
      // Toast cleared: fade out, then unmount.
      setHiding(true)
      const id = setTimeout(() => {
        setVisible(false)
        setHiding(false)
      }, 280)
      return () => clearTimeout(id)
    }
  }, [toast]) // eslint-disable-line react-hooks/exhaustive-deps

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

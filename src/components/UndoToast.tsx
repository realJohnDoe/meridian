import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { cn } from '../lib/utils'

/**
 * Renders the undo-delete toast driven by store.toast.
 * Animates in when a toast appears and fades out when it clears.
 */
export default function UndoToast() {
  const toast = useStore(s => s.toast)
  const setToast = useStore(s => s.setToast)

  const [visible, setVisible] = useState(false)
  const [hiding, setHiding] = useState(false)
  const snapshotRef = useRef<{ title: string; onUndo: () => void } | null>(null)
  const visibleRef = useRef(false)

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
  }, [toast])

  if (!visible) return null

  const snap = snapshotRef.current!

  return (
    <div className={cn(
      'w-full bg-[rgba(36,48,73,.88)] backdrop-blur-[8px] border border-bdr2 rounded-[20px]',
      'px-3.5 py-2 pr-[10px] flex items-center gap-2',
      'shadow-[0_2px_12px_rgba(0,0,0,.3)] pointer-events-auto',
      'transition-[opacity,transform] duration-[250ms] ease-in-out',
      hiding && 'opacity-0 translate-y-[6px]',
    )}>
      <span className="flex-1 text-[12px] text-t2 whitespace-nowrap overflow-hidden text-ellipsis">
        Deleted: <strong>{snap.title}</strong>
      </span>
      <button
        className="text-[11px] font-bold text-ind px-[10px] py-[3px] rounded-[20px] bg-ab hover:bg-ab2"
        onClick={() => { snap.onUndo(); setToast(null) }}
      >
        Undo
      </button>
    </div>
  )
}

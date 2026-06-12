import { useEffect, useRef, type RefObject } from 'react'

export function useHorizontalSwipe(
  ref: RefObject<HTMLElement | null>,
  onPrev: () => void,
  onNext: () => void,
) {
  const onPrevRef = useRef(onPrev)
  const onNextRef = useRef(onNext)
  useEffect(() => { onPrevRef.current = onPrev }, [onPrev])
  useEffect(() => { onNextRef.current = onNext }, [onNext])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let sx = 0, sy = 0
    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
    const onEnd   = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx
      const dy = e.changedTouches[0].clientY - sy
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) onNextRef.current(); else onPrevRef.current()
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend',   onEnd,   { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend',   onEnd)
    }
  }, [ref])
}

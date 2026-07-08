import { toast } from 'sonner'

export function notify(msg: string): void {
  toast.error(msg, { duration: 5000 })
}

export function warn(msg: string): void {
  toast.warning(msg, { duration: 7000 })
}

export function notifyError(prefix: string, e: unknown): void {
  const err = e as Error
  const detail = err?.message || err?.name
  notify(detail ? `${prefix}: ${detail}` : prefix)
}

import { toast } from 'sonner'

export function notify(msg: string): void {
  toast.error(msg, { duration: 5000 })
}

export function warn(msg: string): void {
  toast.warning(msg, { duration: 7000 })
}

/**
 * A warning that can hand the user the evidence behind it.
 *
 * For failures the user cannot act on but *can* report — a conflict with no
 * second writer being the case this exists for. `details` is computed lazily,
 * on click, so the (potentially long) report is only built when someone asks
 * for it. Clipboard access can be denied or absent (non-secure context, older
 * WebView), so the text is also logged: between the two there is always some
 * way to get it out of the device.
 */
export function warnWithDetails(msg: string, details: () => string): void {
  toast.warning(msg, {
    duration: 12000,
    action: {
      label: 'Copy details',
      onClick: () => {
        const text = details()
        // Logged unconditionally: the clipboard is the convenient path, not the
        // only one, and the console copy is what survives a failed write.
        console.warn(text)
        const failed = () => { notify('Could not copy — the details were logged to the console instead.') }
        try {
          // `navigator.clipboard` is typed as always present but is genuinely
          // absent outside a secure context (and in some in-app WebViews), so
          // the access itself can throw, not just the returned promise.
          void navigator.clipboard.writeText(text).catch(failed)
        } catch { failed() }
      },
    },
  })
}

export function notifyError(prefix: string, e: unknown): void {
  const detail = e instanceof Error ? e.message || e.name : undefined
  notify(detail ? `${prefix}: ${detail}` : prefix)
}

/**
 * ConfirmDialogContent — AlertDialogContent at the app's confirm-dialog size:
 * full width less a 1rem gutter on phones, max-w-md from sm up, rounded-xl.
 * Every confirm dialog used to spell those classes out; one wrapper keeps
 * them from drifting the way the delete dialogs' buttons did.
 * `components/ui/` is a shadcn mirror, so the default lives here, not there.
 */
import type { ComponentProps } from 'react'
import { AlertDialogContent } from '../ui/alert-dialog'
import { cn } from '@/lib/cn'

export function ConfirmDialogContent(props: ComponentProps<typeof AlertDialogContent>) {
  return <AlertDialogContent {...props} className={cn('max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md', props.className)} />
}

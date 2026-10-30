import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { Button } from '@/components/primitives/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { previewVaultIcsImport, importVaultIcs } from '@/vaultActions'
import type { VaultRef, IcsImportSummary } from '@/vaultActions'
import { SettingsRow } from './SettingsSection'
import { SkippedEvents } from './SkippedEvents'

/** "1 event" / "3 events" — the import dialog counts events, never "items". */
export function eventCount(n: number): string {
  return `${n} ${n === 1 ? 'event' : 'events'}`
}

/**
 * What the confirm dialog says an import is about to do.
 *
 * `updated` is the sentence that earns the dialog: those entries exist because
 * a previous import of this same calendar created them, and re-importing
 * replaces them wholesale — including anything the user changed about them
 * since. That is not something to discover afterwards.
 */
function importSummary({ added, updated }: IcsImportSummary): string {
  if (added + updated === 0) {
    return 'That file is a calendar, but it holds no events Meridian can place on a date.'
  }
  const kept = 'They become ordinary entries you can edit, link to and delete — Meridian won’t keep them in step with the original calendar.'
  if (updated === 0) return kept
  const already = `${updated} ${updated === 1 ? 'entry' : 'entries'}`
  return `${eventCount(added)} will be added. ${already} imported from this calendar before will be replaced, losing any edits made here. ${kept}`
}

/** The "Import calendar" row and the confirm dialog its file picker opens. */
export function VaultImportRow({ vault }: { vault: VaultRef }) {
  const [importOpen, setImportOpen] = useState(false)
  // The picked file's text, held only for as long as the confirm dialog is up:
  // the import re-plans from it on confirm rather than re-reading the file.
  const [importText, setImportText] = useState<string | null>(null)
  // `null` while `importText` is set means "that file isn't a calendar" — the
  // dialog's error state. Both null means nothing has been picked.
  const [importPlan, setImportPlan] = useState<IcsImportSummary | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  /** How many events the picked file would import — `null` when it isn't a calendar. */
  const importCount = importPlan && importPlan.added + importPlan.updated

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Cleared before the await so picking the same file a second time still
    // fires a change event — the browser won't, for an unchanged value.
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    setImportText(text)
    setImportPlan(previewVaultIcsImport(vault.id, text))
    setImportOpen(true)
  }

  function handleImportConfirm() {
    setImportOpen(false)
    if (importText === null) return
    const result = importVaultIcs(vault.id, importText)
    setImportText(null)
    if (result) toast.success(`Imported ${eventCount(result.added + result.updated)} into ${vault.name}.`)
  }

  return (
    <>
      <SettingsRow
        label="Import calendar"
        description="Bring the events from an .ics file in as ordinary entries — a copy you own, not a subscription."
        control={
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".ics,text/calendar"
              className="hidden"
              onChange={e => { void handleImportFile(e) }}
            />
            <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()} className="gap-1.5">
              <Upload className="size-3.5 stroke-[1.7]" />
              Import .ics
            </Button>
          </>
        }
      />
      <AlertDialog open={importOpen} onOpenChange={setImportOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {importCount === null
                ? 'Not a calendar'
                : importCount === 0
                  ? 'Nothing to import'
                  : `Import ${eventCount(importCount)} into “${vault.name}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {importPlan === null
                ? 'Meridian couldn’t read that file as a calendar. Export your calendar as .ics and pick that file — not a link to it, and not a .zip.'
                : importSummary(importPlan)}
            </AlertDialogDescription>
            {importPlan && <SkippedEvents events={importPlan.skipped} />}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setImportText(null) }}>
              {importCount ? 'Cancel' : 'Close'}
            </AlertDialogCancel>
            {importCount ? (
              <AlertDialogAction className="gap-1.5" onClick={handleImportConfirm}>
                <Upload size={13} />
                Import
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

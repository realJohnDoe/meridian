import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { Link } from '@tanstack/react-router'
import { Trash2, TriangleAlert, AlertCircle, Download, Upload, RefreshCw, ArchiveRestore, ChevronRight, Copy, Check, ExternalLink, ArrowRightLeft } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { readVaultStringArray } from '@/lib/vaultStorage'
import { useStore } from '@/store'
import { useAllParticipants } from '@/hooks'
import {
  syncToBackend, removeVault, renameVault, setVaultColor, setVaultRetentionDays, cacheDirtyCount, startGitHubSignIn,
  GITHUB_APP_INSTALL_URL, APP_URL, exportVaultIcs, previewVaultIcsImport, importVaultIcs,
  previewVaultCopy, copyVaultInto,
} from '@/vaultActions'
import { ParticipantsRow, archiveEntry } from '@/editor'
import { keyRoute } from '@/entryRoute'
import type { VaultRef, IcsImportSummary } from '@/vaultActions'
import { VAULT_COLORS, isWritableVault } from '@/vaultRef'
import { VAULT_COLOR_SWATCH } from '@/components/primitives/occurrence-variants'
import { VaultChip } from '@/components'
import { cn } from '@/lib/cn'
import { SettingsSection, SettingsRow } from './SettingsSection'
import { vaultSummary } from './vaultSummary'
import { archivedEntriesFor } from './archivedEntries'
import type { ArchivedEntry } from './archivedEntries'

/** Above this many archived entries, the list hides behind a disclosure — see `ArchivedRows`. */
const ARCHIVE_COLLAPSE_THRESHOLD = 5

/** One archived entry's row: a link to it, plus its own Unarchive action. */
function ArchivedRows({ archived }: { archived: ArchivedEntry[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {archived.map(({ key, title }) => (
        <li key={key} className="flex items-center justify-between gap-2">
          <Link {...keyRoute(key)} className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline">
            {title}
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => archiveEntry(key, false)}
          >
            <ArchiveRestore className="size-3.5 stroke-[1.7]" />
            Unarchive
          </Button>
        </li>
      ))}
    </ul>
  )
}

interface Props {
  vault: VaultRef
}

/** A vault name, made safe as a bare filename — no path separators or reserved characters. */
function sanitizeFilename(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-') || 'calendar'
}

/**
 * The message a vault owner sends a collaborator to invite them in.
 *
 * No install step: install is per repo (done already, by the owner), and a
 * collaborator's GitHub sign-in is their whole setup — telling them to
 * install would send them somewhere confusing.
 */
function inviteMessage(owner: string, repo: string): string {
  return `I'm sharing a calendar with you in Meridian — tasks and events as plain Markdown files in a GitHub repo, no plugin needed. Once you're added as a collaborator on ${owner}/${repo}, open ${APP_URL}, sign in with GitHub, and pick that repo.`
}

/** "1 event" / "3 events" — the import dialog counts events, never "items". */
function eventCount(n: number): string {
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

/**
 * What the confirm dialog says moving a subscription in is about to do.
 *
 * The sibling of `importSummary` above, and separate from it because the two
 * differ in more than a word: an import is a file the user chose, while this is
 * the events they are already looking at, and only this one can tell them they
 * will stop following the calendar.
 */
function moveInSummary({ added, updated }: IcsImportSummary): string {
  const total = added + updated
  if (total === 0) {
    return 'This subscription isn\u2019t showing any events yet, so there is nothing to move. Try again once it has refreshed.'
  }
  const becomes = total === 1
    ? '1 event becomes an ordinary entry you can edit, link to and delete.'
    : `${total} events become ordinary entries you can edit, link to and delete.`
  if (updated === 0) return `${becomes} They stop following the calendar they came from.`
  const replaced = updated === 1
    ? '1 of them replaces an entry'
    : `${updated} of them replace entries`
  return `${becomes} ${replaced} imported from this calendar before, losing any edits made here.`
}

/**
 * One vault's own settings screen.
 *
 * Scope is answered by *being here* — the screen is the vault — rather than by
 * a dropdown acting as the lid of a card. That is what let the sections below
 * become flat rows instead of a container nested inside a container inside a
 * bottom sheet.
 */
export function VaultSettings({ vault }: Props) {
  const [syncing,      setSyncing]      = useState(false)
  const [name,         setName]         = useState(vault.name)
  const [retentionDays, setRetentionDays] = useState(vault.retentionDays?.toString() ?? '')
  const [confirmOpen,  setConfirmOpen]  = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [dirtyCount,   setDirtyCount]   = useState(0)
  const [importOpen,   setImportOpen]   = useState(false)
  // The picked file's text, held only for as long as the confirm dialog is up:
  // the import re-plans from it on confirm rather than re-reading the file.
  const [importText,   setImportText]   = useState<string | null>(null)
  // `null` while `importText` is set means "that file isn't a calendar" — the
  // dialog's error state. Both null means nothing has been picked.
  const [importPlan,   setImportPlan]   = useState<IcsImportSummary | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [moveInOpen,   setMoveInOpen]   = useState(false)
  const [moveInTarget, setMoveInTarget] = useState<string | null>(null)
  // Default on: the whole point of moving in is to stop depending on the feed,
  // and leaving both would show every event twice in the agenda.
  const [dropFeed,     setDropFeed]     = useState(true)
  /** How many events the picked file would import — `null` when it isn't a calendar. */
  const importCount = importPlan && importPlan.added + importPlan.updated
  const [participants, setParticipants] = useState<string[]>(
    () => readVaultStringArray('meridian_default_participants', vault.id),
  )

  const setDefaultParticipants = useStore(s => s.setDefaultParticipants)
  const vaults                 = useStore(s => s.vaults)
  const items                  = useStore(s => s.items)
  const roots                  = useStore(s => s.roots)
  const lastRefreshed          = useStore(s => s.syncByVault.get(vault.id)?.lastSyncedAt ?? null)
  const needsAttention         = useStore(s => s.syncByVault.get(vault.id)?.needsAttention ?? null)

  const allParticipants = useAllParticipants(items, vault.id)
  // A subscription can only move *into* a vault Meridian can write to, and
  // never into itself.
  const moveInTargets = vaults.filter(v => isWritableVault(v) && v.id !== vault.id)
  const moveInTo      = moveInTarget ?? moveInTargets[0]?.id ?? null
  // Memoized because it is not cheap: the preview re-serializes and re-parses
  // every event the subscription holds, and this screen re-renders on any store
  // change — a sync tick landing while the dialog is open would otherwise redo
  // the whole thing. The count can go stale against a refresh that arrives
  // mid-dialog; `copyVaultInto` re-plans on confirm, so only the number shown
  // is ever behind, never what gets written.
  const moveInPlan = useMemo(
    () => (moveInOpen && moveInTo ? previewVaultCopy(vault.id, moveInTo) : null),
    [moveInOpen, moveInTo, vault.id],
  )
  // The one escape hatch for an archived entry nothing links to — hidden from
  // the calendar and search alike, so this is the only place left to find and
  // undo one. See plans/archived-entries.md PR 3.
  const archived = archivedEntriesFor(roots, vault.id)

  function handleNameBlur() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== vault.name) void renameVault(vault.id, trimmed)
    else setName(vault.name)
  }

  function handleRetentionDaysBlur() {
    const trimmed = retentionDays.trim()
    const parsed = trimmed ? parseInt(trimmed, 10) : NaN
    const days = Number.isFinite(parsed) && parsed > 0 ? parsed : null
    setRetentionDays(days?.toString() ?? '')
    if (days !== (vault.retentionDays ?? null)) void setVaultRetentionDays(vault.id, days)
  }

  function handleParticipantsChange(next: string[]) {
    setParticipants(next)
    // The store action owns both the write and the "is this the vault whose
    // values are currently loaded?" check, so Settings can edit any vault's
    // defaults without disturbing the one a new entry would target.
    setDefaultParticipants(vault.id, next)
  }

  async function handleSyncNow() {
    setSyncing(true)
    try {
      await syncToBackend(vault.id)
    } finally {
      setSyncing(false)
    }
  }

  async function handleRemoveClick() {
    setDirtyCount(await cacheDirtyCount(vault.id).catch(() => 0))
    setConfirmOpen(true)
  }

  async function handleCopyInvite(owner: string, repo: string) {
    try {
      await navigator.clipboard.writeText(inviteMessage(owner, repo))
      setInviteCopied(true)
      setTimeout(() => { setInviteCopied(false) }, 2000)
    } catch {
      // Clipboard access denied or unavailable (non-secure context, some
      // in-app WebViews) — the button just doesn't confirm; nothing else to do.
    }
  }

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

  function handleMoveIn() {
    if (!moveInTo) return
    const result = copyVaultInto(vault.id, moveInTo)
    const name = vaults.find(v => v.id === moveInTo)?.name ?? 'the vault'
    setMoveInOpen(false)
    // After the vault disappears this screen redirects itself (see VaultDetail),
    // so the toast is what carries the outcome to wherever the user lands.
    if (dropFeed) void removeVault(vault.id)
    toast.success(`Moved ${eventCount(result.added + result.updated)} into ${name}.`)
  }

  function handleExport() {
    const ics = exportVaultIcs(vault.id)
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeFilename(vault.name)}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title="Source" description={vaultSummary(vault)}>
        {vault.kind !== 'example' && (
          <SettingsRow
            label="Name"
            description="Renaming doesn’t change this vault’s URL — bookmarks and links keep working."
          >
            <Input value={name} onChange={e => { setName(e.target.value) }} onBlur={handleNameBlur} />
          </SettingsRow>
        )}

        {vault.kind !== 'example' && (
          <SettingsRow
            label="Color"
            description="Shown on this vault's chip on occurrence cards."
          >
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={!vault.color}
                aria-label="No color"
                onClick={() => void setVaultColor(vault.id, null)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border-2',
                  !vault.color ? 'border-primary' : 'border-transparent',
                )}
              >
                <span className="size-4.5 rounded-full border-2 border-dashed border-muted-foreground/50" />
              </button>
              {VAULT_COLORS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={vault.color === value}
                  aria-label={label}
                  onClick={() => void setVaultColor(vault.id, value)}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border-2',
                    vault.color === value ? 'border-primary' : 'border-transparent',
                  )}
                >
                  <span className={cn('size-4.5 rounded-full', VAULT_COLOR_SWATCH[value])} />
                </button>
              ))}
            </div>
          </SettingsRow>
        )}

        {vault.kind === 'local' && (
          <SettingsRow
            label="Folder"
            description={<span className="font-mono break-all">{vault.name}</span>}
            control={
              <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing} className="gap-1.5">
                <RefreshCw className="size-3.5 stroke-[1.7]" />
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            }
          />
        )}

        {vault.kind === 'github' && (
          <SettingsRow
            label="Repository"
            description={
              <span className="font-mono break-all">
                {vault.github.owner}/{vault.github.repo} ({vault.github.branch})
              </span>
            }
            control={
              <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing} className="gap-1.5">
                <RefreshCw className="size-3.5 stroke-[1.7]" />
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            }
          />
        )}

        {vault.kind === 'github' && (
          <SettingsRow
            label="Invite someone"
            description="Add them as a collaborator on GitHub, then send them this message — signing in with GitHub is their whole setup."
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <a
                  href={`https://github.com/${vault.github.owner}/${vault.github.repo}/settings/access`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-3.5 stroke-[1.7]" />
                  Add collaborator on GitHub
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void handleCopyInvite(vault.github.owner, vault.github.repo)}
              >
                {inviteCopied ? <Check className="size-3.5 stroke-[1.7]" /> : <Copy className="size-3.5 stroke-[1.7]" />}
                {inviteCopied ? 'Copied' : 'Copy invite message'}
              </Button>
            </div>
          </SettingsRow>
        )}

        {vault.kind === 'ical' && (
          <SettingsRow
            label="Calendar address"
            // Deliberately not truncated to a hostname: this is a secret
            // address the user may need to copy out again, and hiding most of
            // it would make it unusable for that.
            description={<span className="font-mono break-all">{vault.ical.url}</span>}
            control={
              <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing} className="gap-1.5">
                <RefreshCw className="size-3.5 stroke-[1.7]" />
                {syncing ? 'Refreshing…' : 'Refresh now'}
              </Button>
            }
          />
        )}

        {/* Mirrors SyncButton's popover rows for the attention kinds that can
            apply to this vault — `fs-permission` never applies to a GitHub one. */}
        {needsAttention && (
          <div className="flex flex-col gap-2 px-4 py-3.5">
            {needsAttention.kind === 'reauth' && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-left text-xs text-note hover:underline"
                onClick={() => void startGitHubSignIn({ reconnectVaultId: vault.id })}
              >
                <AlertCircle className="size-3.5 shrink-0" />
                Signed out of GitHub — sign in again
              </button>
            )}
            {needsAttention.kind === 'access' && vault.kind === 'github' && (
              <a
                href={GITHUB_APP_INSTALL_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-note hover:underline"
              >
                <AlertCircle className="size-3.5 shrink-0" />
                Meridian no longer has access to {vault.github.owner}/{vault.github.repo}
              </a>
            )}
            {needsAttention.kind === 'config' && (
              <p className="flex items-center gap-1.5 text-xs text-note">
                <AlertCircle className="size-3.5 shrink-0" />
                {vault.kind === 'github'
                  ? `${vault.github.owner}/${vault.github.repo} (${vault.github.branch})`
                  : vault.name} isn&rsquo;t reachable — it may have been renamed or deleted
              </p>
            )}
            {needsAttention.kind === 'fs-permission' && (
              <p className="flex items-center gap-1.5 text-xs text-note">
                <AlertCircle className="size-3.5 shrink-0" />
                {needsAttention.message}
              </p>
            )}
          </div>
        )}

        {vault.kind !== 'example' && (
          <SettingsRow
            label="Last synced"
            description={
              // The 15-minute cadence is stated only for a subscription, which
              // is the one kind that is polled on a fixed timer rather than
              // pushed to on save.
              [
                lastRefreshed ? formatDistanceToNow(lastRefreshed, { addSuffix: true }) : 'Not yet',
                vault.kind === 'ical' ? 'Checked automatically every 15 minutes.' : null,
              ].filter(Boolean).join('. ')
            }
          />
        )}
      </SettingsSection>

      {/* A subscription has no writable side, so there is nothing for default
          participants to seed — new entries can never land there. */}
      {vault.kind !== 'ical' && (
        <SettingsSection title="New entries" description="Applies to entries created in this vault.">
          <SettingsRow
            label="Default participants"
            description="Added to new entries in this vault automatically. Stored on this device only, so each device (and each person sharing the vault) can set its own."
          >
            <ParticipantsRow
              participants={participants}
              onChange={handleParticipantsChange}
              allParticipants={allParticipants}
            />
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection title="Data">
        {isWritableVault(vault) && (
          <SettingsRow
            label="Auto-archive"
            description="Archive entries automatically once every item is finished and the file hasn't changed for this many days. Leave blank to turn it off."
          >
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="Off"
              value={retentionDays}
              onChange={e => { setRetentionDays(e.target.value) }}
              onBlur={handleRetentionDaysBlur}
              className="w-20"
            />
          </SettingsRow>
        )}
        {isWritableVault(vault) && (
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
        )}
        {vault.kind === 'ical' && (
          <SettingsRow
            label="Move into a vault"
            description={
              moveInTargets.length === 0
                ? 'Copies these events into a vault you own, as entries you can edit. You need a vault Meridian can write to first — add one from Settings.'
                : 'Copy these events into a vault you own, as ordinary entries you can edit. Unlike this subscription, they stay when the calendar changes — and stop following it.'
            }
            control={
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={moveInTargets.length === 0}
                onClick={() => { setMoveInOpen(true) }}
              >
                <ArrowRightLeft className="size-3.5 stroke-[1.7]" />
                Move in
              </Button>
            }
          />
        )}
        <SettingsRow
          label="Export calendar"
          description="Download every entry in this vault as a single .ics file."
          control={
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
              <Download className="size-3.5 stroke-[1.7]" />
              Export .ics
            </Button>
          }
        />
        <SettingsRow
          label="Archived"
          description={
            archived.length === 0
              ? 'Entries you archive are hidden from the calendar and search, and show up here.'
              : `${archived.length} ${archived.length === 1 ? 'entry is' : 'entries are'} hidden from the calendar and search.`
          }
        >
          {archived.length > 0 && (
            archived.length > ARCHIVE_COLLAPSE_THRESHOLD ? (
              <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight size={13} className={cn('transition-transform', archivedOpen && 'rotate-90')} />
                    {archivedOpen ? 'Hide archived entries' : `Show ${archived.length} archived entries`}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1.5">
                  <ArchivedRows archived={archived} />
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <ArchivedRows archived={archived} />
            )
          )}
        </SettingsRow>
        <SettingsRow
          label="Remove vault"
          description={
            vault.kind === 'example'
              ? 'Removes the Tutorial vault from this device. You can add it back anytime.'
              : 'Removes this vault from this device. The original files are not affected.'
          }
          control={
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleRemoveClick}
            >
              <Trash2 className="size-3.5 stroke-[1.7]" />
              Remove
            </Button>
          }
        />
      </SettingsSection>

      <AlertDialog open={moveInOpen} onOpenChange={setMoveInOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Move &ldquo;{vault.name}&rdquo; into a vault</AlertDialogTitle>
            <AlertDialogDescription>
              {moveInSummary(moveInPlan ?? { added: 0, updated: 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-foreground">Move into</span>
              <VaultChip vaultId={moveInTo} onChange={setMoveInTarget} />
            </div>
            <label className="flex items-start gap-2.5 text-sm text-foreground">
              <Checkbox
                checked={dropFeed}
                onCheckedChange={c => { setDropFeed(c === true) }}
                className="mt-0.5"
              />
              <span>
                Remove this subscription afterwards
                <span className="block text-xs text-muted-foreground">
                  Keeping it shows every event twice — once live, once as your copy. The calendar itself isn’t affected either way.
                </span>
              </span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {moveInPlan && moveInPlan.added + moveInPlan.updated > 0 && (
              <AlertDialogAction className="gap-1.5" onClick={handleMoveIn}>
                <ArrowRightLeft size={13} />
                Move in
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove vault</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &ldquo;{vault.name}&rdquo;? This deletes it from this device.
              {vault.kind === 'github' && ' The GitHub repository itself is not affected.'}
              {vault.kind === 'ical' && ' The calendar itself is not affected — only this subscription to it.'}
              {vault.kind === 'example' && ' You can add it back anytime from here.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dirtyCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-xs text-warning-foreground">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                {dirtyCount} unsynced {dirtyCount === 1 ? 'change has' : 'changes have'} not been backed up and will be lost.
              </span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmOpen(false); void removeVault(vault.id) }}
            >
              <Trash2 size={13} />
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

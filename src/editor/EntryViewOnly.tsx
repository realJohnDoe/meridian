import { useRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { useNavigate } from '@tanstack/react-router'
import { MapPin, Link2, User } from 'lucide-react'
import type { Occurrence, Roots, StoreItem } from '@/types'
import type { VaultRef } from '@/vaultRef'
import { Badge } from '@/components/ui/badge'
import { VaultChip } from '@/components'
import EntryBody from './EntryBody'
import { fmtT, parseDateString } from '@/model'
import { fmtShort, formatDurationChip, fmtDuration } from '@/format'
import { useStore } from '@/store'
import { resolveWikilink } from '@/wikilinks'
import { newEntryRoute, keyRoute } from '@/routes'

interface Props {
  occ:   Occurrence
  vault: VaultRef
  items: StoreItem[]
  roots: Roots
}

function extraString(extra: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = extra?.[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The plain, non-editable entry view for a `view-only` vault (an iCal
 * subscription — see hooks/useEntryAccess). There is no source to write back
 * to, so this offers nothing to press: no type toggle, no property chips, no
 * delete button, no vault picker. `EntryEditor` stays exactly as it is for
 * every other vault kind, including the Tutorial sandbox.
 *
 * `EntryBody` is reused rather than rebuilt: `markdownLivePreview` already
 * renders formatting on every line with no cursor, so its read-only
 * configuration renders the markdown *better* than the editable one, and
 * wikilink navigation keeps working for free — only text edits are blocked.
 */
export default function EntryViewOnly({ occ, vault, items, roots }: Props) {
  const hour12   = useStore(s => s.localePrefs.hour12)
  const navigate = useNavigate()
  const viewRef  = useRef<EditorView | null>(null)

  const { title, participants, duration, extra } = occ.metadata
  const location  = extraString(extra, 'location')
  const url       = extraString(extra, 'url')
  const organizer = extraString(extra, 'organizer')

  const dateBadge = (() => {
    const d = parseDateString(occ.date)
    return d ? fmtShort(d) : occ.date
  })()
  const timeBadge = fmtT(occ.time, hour12)
  const durationBadge = duration
    ? (occ.time ? formatDurationChip(duration, { date: occ.date, time: occ.time }, hour12) : fmtDuration(duration))
    : null

  // Resolved inside this entry's own vault, same as the editable path — a
  // bare `[[slug]]` in a file means that vault's slug, never another vault's.
  const handleOpenWikilink = (ref: string) => {
    const target = resolveWikilink(ref, roots, vault.id)
    if (!target) { void navigate(newEntryRoute(ref)); return }
    void navigate(keyRoute(target))
  }

  return (
    <section className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]"><div className="px-3.5 pt-4.5 pb-30 lg:max-w-3xl lg:mx-auto">

        <div className="flex items-start gap-2.5 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-light text-foreground leading-snug">{title}</p>
            <div className="flex items-center gap-2 mt-0.5 min-w-0">
              <VaultChip vaultId={vault.id} />
            </div>
          </div>
        </div>

        <div className="flex gap-1.5 flex-wrap mb-4">
          {dateBadge && <Badge variant="tag">{dateBadge}</Badge>}
          {timeBadge && <Badge variant="tag">{timeBadge}</Badge>}
          {durationBadge && <Badge variant="tag">{durationBadge}</Badge>}
          {participants.map(p => <Badge key={p} variant="tag">{p}</Badge>)}
        </div>

        {(location || url || organizer) && (
          <div className="flex flex-col gap-1.5 mb-4 text-xs text-muted-foreground">
            {location && (
              <span className="flex items-center gap-1.5"><MapPin size={13} className="shrink-0" />{location}</span>
            )}
            {url && (
              <a href={url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 w-fit text-primary hover:underline">
                <Link2 size={13} className="shrink-0" />{url}
              </a>
            )}
            {organizer && (
              <span className="flex items-center gap-1.5"><User size={13} className="shrink-0" />{organizer}</span>
            )}
          </div>
        )}

        <EntryBody
          body={occ.metadata.body ?? ''}
          roots={roots}
          vaultId={vault.id}
          items={items}
          viewRef={viewRef}
          onOpenWikilink={handleOpenWikilink}
          readOnly
        />

      </div></div>
    </section>
  )
}

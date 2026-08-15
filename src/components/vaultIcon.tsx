import { HardDrive, GitBranch, BookOpen } from 'lucide-react'
import type { VaultKind } from '@/vaultRef'

/**
 * A vault's icon, by kind.
 *
 * Written as explicit branches rather than a `kind → component` lookup because
 * resolving a component at render time — assigning it to a capitalised local,
 * or indexing a map in JSX — makes React see a fresh element type on every
 * render and remount the subtree. `react-hooks/static-components` rejects it,
 * and the rule is right: this is the shape that reconciles.
 */
export function VaultIcon({ kind, className }: { kind: VaultKind; className?: string }) {
  if (kind === 'local')  return <HardDrive className={className} />
  if (kind === 'github') return <GitBranch className={className} />
  return <BookOpen className={className} />
}

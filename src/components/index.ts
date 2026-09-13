// Leaf shared UI only. Nothing here may import a feature module
// (@/calendar, @/search, @/editor, ...): components/ sits *below* the
// features that compose it, and an import back up is what every cycle this
// barrel has ever been part of was made of. App-shell composites that do
// need features live beside the shell that mounts them — see
// routes/-appSidebar.tsx and routes/-searchBar.tsx.
export { FlipList } from './FlipList'
export { default as OccurrenceCard } from './OccurrenceCard'
export { default as MarkdownTaskCard } from './MarkdownTaskCard'
export { default as TagChip, AddChip } from './TagChip'
export { default as AppErrorFallback } from './AppErrorFallback'
export { default as SyncButton } from './SyncButton'
export { default as ViewFilterButton } from './ViewFilterButton'
export { default as VaultChip } from './VaultChip'
// Exported for `@/settings`, which renders it in the vault list; `components/`
// internals are otherwise private to this subtree.
export { VaultIcon } from './vaultIcon'

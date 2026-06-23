import { HardDrive, GitBranch, BookOpen } from 'lucide-react'

export function vaultIcon(kind: string) {
  if (kind === 'local')  return HardDrive
  if (kind === 'github') return GitBranch
  return BookOpen
}

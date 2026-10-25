import { Users } from 'lucide-react'
import ChipListRow from './ChipListRow'

interface Props {
  participants:     string[]
  onChange:         (next: string[]) => void
  allParticipants?: string[]
}

export default function ParticipantsRow({ participants, onChange, allParticipants }: Props) {
  return <ChipListRow values={participants} onChange={onChange} suggestions={allParticipants} noun="person" icon={Users} />
}

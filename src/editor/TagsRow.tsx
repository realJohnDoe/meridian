import { Tag } from 'lucide-react'
import ChipListRow from './ChipListRow'

interface Props {
  tags:     string[]
  onChange: (next: string[]) => void
}

export default function TagsRow({ tags, onChange }: Props) {
  return <ChipListRow values={tags} onChange={onChange} noun="tag" icon={Tag} />
}

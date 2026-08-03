import { cva } from 'class-variance-authority'

// Pill-shaped segmented control — used for the item-type selector and
// interval/end-date tabs. Pair with ToggleGroup/ToggleGroupItem. The inset
// shadow reads as a groove the selected item (data-[state=on], below) sits
// inside of, mirroring that item's own raised drop-shadow.
const segmentedGroupVariants = cva('flex gap-0.75 bg-secondary rounded-full p-0.75 border border-input w-fit shadow-[inset_0_1px_3px_rgb(0_0_0/.35)]')

const segmentedItemVariants = cva([
  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-muted-foreground',
  'cursor-pointer transition-all whitespace-nowrap h-auto min-w-0',
  'data-[state=on]:bg-background data-[state=on]:text-secondary-foreground data-[state=on]:[box-shadow:0_1px_4px_rgb(0_0_0/.35)]',
])

export { segmentedGroupVariants, segmentedItemVariants }

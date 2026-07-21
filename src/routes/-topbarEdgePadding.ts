import { cn } from '@/lib/cn'

// Any edge that leads with an icon button needs less container padding than one that leads with
// plain text: the button's own h-10 box already insets it (54 - 40) / 2 = 7px from the bar edge,
// matching the vertical inset, so full 14px container padding there would double up. An edge with
// no leading button (a text label, or nothing) keeps the roomier 14px.
export function topbarEdgePadding(leftHasButton: boolean, rightHasButton: boolean) {
  return cn(
    rightHasButton ? 'pr-1.75' : 'pr-3.5',
    leftHasButton ? 'pl-1.75' : 'pl-3.5',
  )
}

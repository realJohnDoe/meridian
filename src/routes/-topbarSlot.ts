import { createContext, use } from 'react'

export const TopbarSlotContext = createContext<HTMLDivElement | null>(null)
export const useTopbarSlot = () => use(TopbarSlotContext)

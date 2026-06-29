import { createContext, useContext } from 'react'

export const TopbarSlotContext = createContext<HTMLDivElement | null>(null)
export const useTopbarSlot = () => useContext(TopbarSlotContext)

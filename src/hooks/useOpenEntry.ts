import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { entryRoute } from '@/routes/-entryRoute'
import type { Occurrence, EditScope } from '@/types'

export function useOpenEntry() {
  const navigate = useNavigate()
  return useCallback(
    (occ: Occurrence, scope?: EditScope) => navigate(entryRoute(occ, scope)),
    [navigate],
  )
}

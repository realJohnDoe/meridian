import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { entryRoute } from '@/routes'
import type { Occurrence, EditScope } from '@/types'

export function useOpenEntry() {
  const navigate = useNavigate()
  return useCallback(
    (occ: Occurrence, scope?: EditScope, opts?: { replace?: boolean }) =>
      navigate({ ...entryRoute(occ, scope), replace: opts?.replace }),
    [navigate],
  )
}

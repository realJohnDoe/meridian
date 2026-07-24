import { useMediaQuery } from "@/hooks"

export function useIsTouchDevice() {
  return useMediaQuery("(pointer: coarse)")
}

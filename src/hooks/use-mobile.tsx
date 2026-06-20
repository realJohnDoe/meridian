import { useMediaQuery } from "./use-media-query"

export function useIsMobile() {
  return !useMediaQuery("(min-width: 768px)")
}

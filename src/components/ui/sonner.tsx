import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      richColors
      className="toaster group"
      // assignOffset writes these as inline CSS vars, beating the runtime stylesheet.
      // top: var(--th)+8px places toasts just below the top bar.
      // 14px left/right matches the filter overlay horizontal padding.
      offset={{ top: "calc(var(--th) + 8px)" }}
      mobileOffset={{ top: "calc(var(--th) + 8px)", left: "14px", right: "14px" }}
      style={{ "--width": "min(calc(100vw - 28px), 402px)" } as React.CSSProperties}
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:shadow-lg",
          // Reuse the shadcn secondary button variant for the action button
          actionButton: cn(buttonVariants({ variant: "secondary", size: "sm" })),
          cancelButton: cn(buttonVariants({ variant: "ghost", size: "sm" })),
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

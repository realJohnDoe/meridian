import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react"
import { Toaster as Sonner } from "sonner"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/cn"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // Both app themes (Meridian, One Dark) are dark; toast surfaces come from
      // --card/--destructive vars, so they follow the active theme regardless.
      theme="dark"
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

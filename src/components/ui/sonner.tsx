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
      position="bottom-center"
      richColors
      className="toaster group"
      // mobileOffset is written as inline CSS vars by Sonner's assignOffset,
      // so these win over any stylesheet. 14px = filter overlay horizontal padding.
      // bottom clears the 52px search bar (bottom-float: var(--nh)+14px) + 8px gap.
      mobileOffset={{ bottom: "calc(var(--nh) + 74px)", left: "14px", right: "14px", top: "16px" }}
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

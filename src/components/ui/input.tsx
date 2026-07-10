import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/cn"

const inputVariants = cva(
  "flex w-full text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        // Boxed control — the house style used across dialogs and forms
        default: "h-control rounded-lg border border-border/50 bg-secondary px-3 text-xs font-mono focus:border-primary",
        // Chromeless — for inputs embedded in an already-styled wrapper (e.g. a search bar)
        ghost: "border-none bg-transparent text-sm",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface InputProps
  extends Omit<React.ComponentProps<"input">, "size">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input, inputVariants }

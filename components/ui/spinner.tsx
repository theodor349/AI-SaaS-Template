import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Loader2Icon } from "lucide-react"

const spinnerVariants = cva("motion-safe:animate-spin", {
  variants: {
    size: {
      default: "size-4",
      lg: "size-8",
    },
  },
  defaultVariants: {
    size: "default",
  },
})

function Spinner({ className, size, ...props }: React.ComponentProps<"svg"> & VariantProps<typeof spinnerVariants>) {
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label="Loading" className={cn(spinnerVariants({ size }), className)} {...props} />
  )
}

export { Spinner }

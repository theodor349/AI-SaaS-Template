import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const skeletonVariants = cva("rounded-none bg-muted", {
  variants: {
    animation: {
      none: "",
      pulse: "motion-safe:animate-pulse",
    },
    size: {
      line: "h-5 w-full",
      input: "h-8 w-full",
      fill: "size-full",
      text: "box-decoration-clone text-transparent select-none",
    },
  },
  defaultVariants: {
    animation: "none",
  },
})

function Skeleton({ className, size, animation, asChild = false, ...props }: React.ComponentProps<"div"> &
  VariantProps<typeof skeletonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"

  return (
    <Comp
      data-slot="skeleton"
      className={cn(skeletonVariants({ size, animation }), className)}
      {...props}
    />
  )
}

export { Skeleton }

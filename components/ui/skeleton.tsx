import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const skeletonVariants = cva("animate-pulse rounded-none bg-muted", {
  variants: {
    size: {
      line: "h-5 w-full",
    },
  },
})

function Skeleton({ className, size, ...props }: React.ComponentProps<"div"> &
  VariantProps<typeof skeletonVariants>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(skeletonVariants({ size }), className)}
      {...props}
    />
  )
}

export { Skeleton }

// No client directive: server-rendered documents use these without shipping JavaScript.
import * as React from "react"
import { cn } from "cn"

// `stack` turns rows into labelled blocks on narrow screens. Pass it to the
// table, header, body, and rows, and give each cell its column's `label`.
function Table({ className, stack = false, ...props }: React.ComponentProps<"table"> & { stack?: boolean }) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-xs", stack && "max-sm:block", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, stack = false, ...props }: React.ComponentProps<"thead"> & { stack?: boolean }) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", stack && "max-sm:sr-only", className)}
      {...props}
    />
  )
}

function TableBody({ className, stack = false, ...props }: React.ComponentProps<"tbody"> & { stack?: boolean }) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", stack && "max-sm:block", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, stack = false, ...props }: React.ComponentProps<"tr"> & { stack?: boolean }) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        stack && "max-sm:block max-sm:py-2",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

// `wrap` lets prose cells break onto several lines instead of widening the
// table. `label` names the cell's column when a stacked table shows it as a block.
function TableCell({ className, wrap = false, label, ...props }: React.ComponentProps<"td"> & { wrap?: boolean; label?: string }) {
  return (
    <td
      data-slot="table-cell"
      data-label={label}
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        wrap && "min-w-36 align-top whitespace-normal",
        label !== undefined && "max-sm:block max-sm:py-1 max-sm:whitespace-normal max-sm:before:block max-sm:before:font-medium max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// Reserve the content's actual height, including text wrapping at narrow widths.
export function ContentSkeleton({ children, loading = true }: { children: ReactNode; loading?: boolean }) {
  if (!loading) {
    return children;
  }

  return (
    <div aria-hidden="true" inert className="relative">
      <div className="invisible">{children}</div>
      <div className="absolute inset-0">
        <Skeleton size="fill" animation="pulse" />
      </div>
    </div>
  );
}

export function TextSkeleton({ children }: { children: ReactNode }) {
  return (
    <p aria-hidden="true">
      <Skeleton asChild size="text" animation="pulse">
        <span>{children}</span>
      </Skeleton>
    </p>
  );
}

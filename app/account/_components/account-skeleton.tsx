import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// Reserve the content's actual height, including text wrapping at narrow widths.
export function AccountSkeleton({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" inert className="relative">
      <div className="invisible">{children}</div>
      <div className="absolute inset-0">
        <Skeleton size="fill" />
      </div>
    </div>
  );
}

export function AccountTextSkeleton({ children }: { children: ReactNode }) {
  return (
    <p aria-hidden="true">
      <Skeleton asChild size="text">
        <span>{children}</span>
      </Skeleton>
    </p>
  );
}

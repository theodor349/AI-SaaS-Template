"use client";

import { usePathname } from "next/navigation";

// The landing page sets its own width; other pages share a reading column.
export function PageContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return children;
  return <div className="mx-auto max-w-3xl">{children}</div>;
}

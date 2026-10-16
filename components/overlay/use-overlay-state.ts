"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { overlayHistory } from "@/lib/overlay-history";

// Open state for the shared overlay components, controlled or not. While open, the
// overlay owns a history entry, so Android's back gesture closes it and keeps the page.
export function useOverlayState({ open: openProp, defaultOpen = false, onOpenChange }: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;

  function setOpen(next: boolean) {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  const close = useEffectEvent(() => setOpen(false));
  useEffect(() => {
    if (!open) return;
    return overlayHistory?.open(close);
  }, [open]);

  return [open, setOpen] as const;
}

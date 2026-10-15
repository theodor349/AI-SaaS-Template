"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

export function CookiePreferences({ open, onOpenChange, onCloseAutoFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Cookie Preferences</DialogTitle>
          <DialogDescription>This template uses essential cookies and browser storage for sign-in, security, and remembering your theme. No optional analytics or advertising cookies are configured.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p id="essential-cookies" className="font-medium">Essential cookies</p>
            <p className="text-muted-foreground">Always active</p>
          </div>
          <Switch checked disabled aria-labelledby="essential-cookies" />
        </div>
        <DialogFooter>
          <DialogClose asChild><Button>Done</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

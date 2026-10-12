"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CookiePreferences } from "@/components/layout/cookie-preferences";

export function CookiePreferencesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Cookie Preferences</Button>
      <CookiePreferences open={open} onOpenChange={setOpen} />
    </>
  );
}

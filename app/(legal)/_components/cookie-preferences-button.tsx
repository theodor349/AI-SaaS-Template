"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CookiePreferences } from "@/components/consent/cookie-preferences";

export function CookiePreferencesButton() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={buttonRef} variant="outline" onClick={() => setOpen(true)}>Cookie Preferences</Button>
      <CookiePreferences open={open} onOpenChange={setOpen}
        onCloseAutoFocus={(event) => { event.preventDefault(); buttonRef.current?.focus(); }} />
    </>
  );
}

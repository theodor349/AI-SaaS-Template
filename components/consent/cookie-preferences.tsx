"use client";

import { useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { allChoices, type ConsentChoices } from "@/lib/consent/cookie";
import { servicesByCategory } from "@/lib/consent/service";
import { consentServices } from "@/lib/consent/services";
import { saveConsent, useConsentState } from "./consent-provider";

const sections = servicesByCategory(consentServices);

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
          <DialogDescription>Choose which optional services may run in this browser. You can change this at any time.</DialogDescription>
        </DialogHeader>
        <PreferencesForm onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// Mounts with the dialog, so each opening starts from the stored choice.
function PreferencesForm({ onSaved }: { onSaved: () => void }) {
  const consent = useConsentState();
  const [choices, setChoices] = useState(() => consent?.choices ?? allChoices(false));

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    saveConsent(choices);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {sections.map((section) => (
          <CategoryChoice key={section.category} section={section}
            checked={section.category === "essential" || choices[section.category]}
            onCheckedChange={(checked) => {
              if (section.category === "essential") return;
              setChoices({ ...choices, [section.category]: checked } satisfies ConsentChoices);
            }} />
        ))}
      </ul>
      <DialogFooter>
        <Button type="submit">Save preferences</Button>
      </DialogFooter>
    </form>
  );
}

function CategoryChoice({ section, checked, onCheckedChange }: {
  section: (typeof sections)[number];
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = `consent-category-${section.category}`;
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p id={`${id}-label`} className="font-medium">{section.label}</p>
          <p id={`${id}-description`} className="text-muted-foreground">{section.description}</p>
        </div>
        <Switch checked={checked} disabled={section.category === "essential"} onCheckedChange={onCheckedChange}
          aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} />
      </div>
      <ul aria-label={`${section.label} services`} className="flex flex-col gap-1 border-l pl-3">
        {section.services.map((service) => (
          <li key={service.id}><span className="font-medium">{service.name}</span> · <span className="text-muted-foreground">{service.purpose}</span></li>
        ))}
      </ul>
    </li>
  );
}

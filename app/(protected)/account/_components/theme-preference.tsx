"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setThemePreference, useThemePreference } from "@/components/theme/use-theme";
import { parseThemePreference } from "@/lib/theme";

const options = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

export function ThemePreference() {
  // Unknown until hydration; the options stay in place, disabled and unselected.
  const preference = useThemePreference();

  return (
    <Card aria-label="Theme" aria-busy={!preference}>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>Applies to this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Theme"
          disabled={!preference}
          value={preference ?? ""}
          // Choosing the selected option again reports an empty value; keep the choice.
          onValueChange={(value) => value && setThemePreference(parseThemePreference(value))}
        >
          {options.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardContent>
    </Card>
  );
}

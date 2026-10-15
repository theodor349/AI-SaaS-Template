import type { MetadataRoute } from "next";
import { appConfig } from "@/app.config";

type Manifest = MetadataRoute.Manifest;
export type ManifestShortcut = NonNullable<Manifest["shortcuts"]>[number];

// The installed app's images. app/pwa/[asset]/route.tsx draws each one from app/icon.svg
// and the app config when the app builds, and app/manifest.ts lists them.
export const pwaIcons = [
  { name: "icon-192.png", size: 192, purpose: "any" },
  { name: "icon-512.png", size: 512, purpose: "any" },
  // Android crops maskable icons to its launcher's shape, so these draw the brand
  // icon inside the safe zone on a full-bleed background.
  { name: "maskable-192.png", size: 192, purpose: "maskable" },
  { name: "maskable-512.png", size: 512, purpose: "maskable" },
] as const;

// Shown in Android's install dialog. These are branded placeholders; a product can
// replace them with real captures of its app at the same sizes.
export const pwaScreenshots = [
  { name: "screenshot-narrow.png", width: 1080, height: 1920, formFactor: "narrow" },
  { name: "screenshot-wide.png", width: 1920, height: 1080, formFactor: "wide" },
] as const;

export type PwaIcon = (typeof pwaIcons)[number];
export type PwaScreenshot = (typeof pwaScreenshots)[number];

export function pwaAssetPath(name: string) {
  return `/pwa/${name}`;
}

export function manifestIcons(): Manifest["icons"] {
  return pwaIcons.map(({ name, size, purpose }) => ({
    src: pwaAssetPath(name),
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  }));
}

export function manifestScreenshots(): Manifest["screenshots"] {
  return pwaScreenshots.map(({ name, width, height, formFactor }) => ({
    src: pwaAssetPath(name),
    sizes: `${width}x${height}`,
    type: "image/png",
    form_factor: formFactor,
    label: `${appConfig.appName} — ${appConfig.tagline}`,
  }));
}

// A long-press shortcut on the installed app's icon. Declare it next to the route it opens.
export function defineShortcut({ name, url }: { name: string; url: string }): ManifestShortcut {
  return { name, url, icons: [{ src: pwaAssetPath("icon-192.png"), sizes: "192x192", type: "image/png" }] };
}

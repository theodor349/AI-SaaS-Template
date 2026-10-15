import type { MetadataRoute } from "next";
import { appConfig } from "@/app.config";
import { AUTHENTICATED_DESTINATION } from "@/lib/auth";
import { manifestIcons, manifestScreenshots } from "@/lib/pwa/assets";
import { themeColors } from "@/lib/theme";
import { accountShortcut } from "./(protected)/account/shortcut";
import { billingShortcut } from "./(protected)/billing/shortcut";

// Makes the app installable. The browser derives the installed app's identity from
// `id`, so never change it: a new id installs a second, separate app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: appConfig.appName,
    short_name: appConfig.shortName,
    description: appConfig.description,
    start_url: AUTHENTICATED_DESTINATION,
    scope: "/",
    display: "standalone",
    // A manifest has one color each; the page's theme-color meta follows the chosen theme.
    background_color: themeColors.light,
    theme_color: themeColors.light,
    icons: manifestIcons(),
    screenshots: manifestScreenshots(),
    shortcuts: [billingShortcut, accountShortcut],
  };
}

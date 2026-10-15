import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";
import { brandIconDataUrl } from "@/lib/brand-icon";

export const alt = `${appConfig.appName} — ${appConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link-preview image for every page, built from the app config and brand icon.
export default async function OpenGraphImage() {
  const { background, foreground, muted } = appConfig.brand;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 80, background, color: foreground }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 36 }}>
          <img src={await brandIconDataUrl()} alt="" width={88} height={88} />
          {appConfig.appName}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 76, lineHeight: 1.1, letterSpacing: -2 }}>{appConfig.tagline}</div>
          <div style={{ fontSize: 32, lineHeight: 1.4, color: muted }}>{appConfig.description}</div>
        </div>
      </div>
    ),
    size,
  );
}

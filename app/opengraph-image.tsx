import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";
import { brandIconSrc } from "@/lib/brand-icon";
import { openGraphImage } from "@/lib/seo";

export const alt = openGraphImage.alt;
export const size = { width: openGraphImage.width, height: openGraphImage.height };
export const contentType = "image/png";

// The link preview image for every page, drawn from the app config and brand icon.
export default async function OpenGraphImage() {
  const { background, foreground, muted } = appConfig.brandColors;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 80, background, color: foreground }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 36 }}>
          <img src={await brandIconSrc()} alt="" width={88} height={88} />
          {appConfig.appName}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -2 }}>{appConfig.tagline}</div>
          <div style={{ fontSize: 30, lineHeight: 1.4, color: muted }}>{appConfig.companyName}</div>
        </div>
      </div>
    ),
    size,
  );
}

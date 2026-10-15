import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";
import { brandIconDataUrl } from "@/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners itself and shows transparency as black, so the icon sits on
// an opaque square of the brand background.
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: appConfig.brand.background }}>
        <img src={await brandIconDataUrl()} alt="" width={size.width} height={size.height} />
      </div>
    ),
    size,
  );
}

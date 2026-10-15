import { ImageResponse } from "next/og";
import { appConfig } from "@/app.config";
import { brandIconSrc } from "@/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS masks the icon itself and shows transparency as black, so the brand
// background fills the corners.
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: appConfig.brandColors.background }}>
        <img src={await brandIconSrc()} alt="" width={size.width} height={size.height} />
      </div>
    ),
    size,
  );
}

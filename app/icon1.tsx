import { ImageResponse } from "next/og";
import { brandIconSrc } from "@/lib/brand-icon";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// A PNG copy of icon.svg for browsers without SVG favicons, such as Safari before 26.
// Browsers that support SVG favicons use icon.svg instead.
export default async function PngIcon() {
  return new ImageResponse(
    <img src={await brandIconSrc()} alt="" width={size.width} height={size.height} />,
    size,
  );
}

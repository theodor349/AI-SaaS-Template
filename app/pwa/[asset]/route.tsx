import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { appConfig } from "@/app.config";
import { brandIconSrc } from "@/lib/brand-icon";
import { pwaIcons, pwaScreenshots, type PwaIcon, type PwaScreenshot } from "@/lib/pwa/assets";

export const dynamic = "force-static";
export const dynamicParams = false;

// Android only promises to show a maskable icon's centered circle with 80% of its
// width. The largest square in that circle is 0.8 / √2 of the icon, so the brand icon
// fits whatever its shape.
const MASKABLE_SCALE = 0.8 / Math.SQRT2;

export function generateStaticParams() {
  return [...pwaIcons, ...pwaScreenshots].map(({ name }) => ({ asset: name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const icon = pwaIcons.find(({ name }) => name === asset);
  if (icon) return drawIcon(icon);
  const screenshot = pwaScreenshots.find(({ name }) => name === asset);
  if (screenshot) return drawScreenshot(screenshot);
  notFound();
}

async function drawIcon({ size, purpose }: PwaIcon) {
  const iconSize = purpose === "maskable" ? Math.floor(size * MASKABLE_SCALE) : size;
  const background = purpose === "maskable" ? appConfig.brandColors.background : "transparent";
  return new ImageResponse(
    (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background }}>
        <img src={await brandIconSrc()} alt="" width={iconSize} height={iconSize} />
      </div>
    ),
    { width: size, height: size },
  );
}

async function drawScreenshot({ width, height }: PwaScreenshot) {
  const { background, foreground, muted } = appConfig.brandColors;
  const unit = Math.min(width, height) / 1080;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 48 * unit, width: "100%", height: "100%", padding: 96 * unit, background, color: foreground, textAlign: "center" }}>
        <img src={await brandIconSrc()} alt="" width={240 * unit} height={240 * unit} />
        <div style={{ fontSize: 48 * unit }}>{appConfig.appName}</div>
        <div style={{ maxWidth: 1400 * unit, fontSize: 96 * unit, lineHeight: 1.05, letterSpacing: -2 * unit }}>{appConfig.tagline}</div>
        <div style={{ maxWidth: 1100 * unit, fontSize: 36 * unit, lineHeight: 1.4, color: muted }}>{appConfig.description}</div>
      </div>
    ),
    { width, height },
  );
}

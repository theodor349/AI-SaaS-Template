import { readFile } from "node:fs/promises";
import { join } from "node:path";

// app/icon.svg, the one brand icon source, as a data URL for `ImageResponse`. Generated
// images that embed it are prerendered at build time, when the source tree is readable.
export async function brandIconDataUrl() {
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "base64");
  return `data:image/svg+xml;base64,${svg}`;
}

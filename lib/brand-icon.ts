import { readFile } from "node:fs/promises";
import { join } from "node:path";

// app/icon.svg as an image source for generated images. That file is the one
// brand source: Next.js serves it as the favicon, and the Apple icon and Open
// Graph image draw it.
export async function brandIconSrc() {
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "base64");
  return `data:image/svg+xml;base64,${svg}`;
}

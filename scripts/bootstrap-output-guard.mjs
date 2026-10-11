// A disconnected terminal can make Next's exception logger repeatedly write to
// the same failed stream. Exit so bootstrap can shut down the managed services.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", () => process.exit(1));
}

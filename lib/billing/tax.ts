// Pricing copy for a catalog price's Polar tax behavior: "inclusive",
// "exclusive", or "location", where tax depends on where the buyer lives.
export function taxDescription(taxBehavior: string) {
  if (taxBehavior === "inclusive") return "Tax included";
  if (taxBehavior === "exclusive") return "Tax added at checkout";
  return "Final tax calculated at checkout";
}

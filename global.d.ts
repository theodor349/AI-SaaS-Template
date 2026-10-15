declare module "*.css";
// Vite's raw text imports, used by tests that run a shipped script as a string.
declare module "*?raw" {
  const content: string;
  export default content;
}

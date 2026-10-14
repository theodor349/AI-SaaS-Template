import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";
import { plugin as shadcn } from "@shadcn/lint";

export default defineConfig([
  ...nextVitals,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts}"],
  })),
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { shadcn },
    // Add chosen shadcn rules here. Installing the plugin enables no rules.
    rules: {
      "shadcn/no-restyle": "error",
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Wide-event logging: Convex functions use the builders in
    // convex/lib/functions.ts and components use the hooks in lib/convex.ts.
    files: ["**/*.{ts,tsx,mts}"],
    ignores: ["convex/lib/functions.ts", "lib/convex.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "convex/react",
          importNames: ["useMutation", "useAction"],
          message: "Use useMutation/useAction from @/lib/convex so calls carry a logging flow.",
        }],
        patterns: [{
          group: ["**/_generated/server"],
          importNames: ["query", "mutation", "action", "internalQuery", "internalMutation", "internalAction", "httpAction"],
          message: "Register functions with the builders in convex/lib/functions.ts so they emit wide events.",
        }],
      }],
    },
  },
  globalIgnores(["convex/_generated/**", "components/ui/**"]),
]);

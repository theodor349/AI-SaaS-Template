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
    // Convex bundles these files, so they cannot depend on the Next.js runtime.
    files: ["convex/**/*.ts", "app.config.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["next", "next/*", "@/*"] }],
    },
  },
  globalIgnores(["convex/_generated/**", "components/ui/**"]),
]);

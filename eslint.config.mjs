import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Note: react-hooks rule downgrades were removed — eslint-config-next
  // 16.4.x registers the plugin internally and a bare rules block can no
  // longer reference it.
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OpenNext Cloudflare build output:
    ".open-next/**",
    // Separate NestJS backend project with its own toolchain:
    "backend/**",
    // Standalone Node verification scripts run outside the Next.js/TS stack.
    "ops/**",
  ]),
]);

export default eslintConfig;

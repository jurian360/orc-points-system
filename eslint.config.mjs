import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // New in the React Compiler-era react-hooks plugin that ships with Next
      // 16. The app does not use the compiler, and the code these flag (fetch
      // on mount, a ref holding the latest callback) works as written — kept
      // visible as warnings rather than rewritten as part of the upgrade.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];

export default eslintConfig;

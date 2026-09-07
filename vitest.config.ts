import { defineConfig } from "vitest/config";
import path from "path";

// إعداد مستقل عن vite.config.ts لأن جذر البناء هناك مجلد client،
// بينما الاختبارات تعيش بجوار الشيفرة في client/src.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["client/src/**/*.test.ts"],
  },
});

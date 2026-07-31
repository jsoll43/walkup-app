import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        assetFileNames(assetInfo) {
          if (assetInfo.name?.endsWith(".css")) return "assets/app.css";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  server: {
    host: true,
  },
});

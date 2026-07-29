import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      ignored: [
        "**/.git/**",
        "**/.playwright-cli/**",
        "**/archive/**",
        "**/migration/**",
        "**/offline-dist-*/**",
        "**/output/**",
        "**/runtime/**",
        "**/exports/**",
        "**/*.{pt,pth,onnx,whl,tar,gz,zip}",
      ],
    },
    proxy: {
      "/api": "http://localhost:4177",
    },
  },
});

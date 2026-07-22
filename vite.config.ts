import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/oxford-3000-study/",
  plugins: [react()],
});

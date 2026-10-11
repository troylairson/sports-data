import { defineConfig } from "astro/config";

// Served from GitHub Pages at https://troylairson.github.io/sports-data/
export default defineConfig({
  site: "https://troylairson.github.io",
  base: "/sports-data",
  trailingSlash: "always",
});

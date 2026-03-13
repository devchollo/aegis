import fs from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { build as esbuild } from "esbuild";
import { defineConfig } from "vite";

const rootDir = __dirname;
const distDir = path.resolve(rootDir, "dist");

function buildExtensionScripts() {
  return {
    name: "build-extension-scripts",
    apply: "build" as const,
    async closeBundle() {
      await Promise.all([
        esbuild({
          entryPoints: [path.resolve(rootDir, "src/background/index.ts")],
          outfile: path.resolve(distDir, "background.js"),
          bundle: true,
          alias: {
            "@": path.resolve(rootDir, "src")
          },
          format: "esm",
          target: "chrome114",
          platform: "browser",
          legalComments: "none"
        }),
        esbuild({
          entryPoints: [path.resolve(rootDir, "src/content/index.ts")],
          outfile: path.resolve(distDir, "content.js"),
          bundle: true,
          alias: {
            "@": path.resolve(rootDir, "src")
          },
          format: "iife",
          target: "chrome114",
          platform: "browser",
          legalComments: "none"
        })
      ]);

      fs.copyFileSync(
        path.resolve(rootDir, "manifest.json"),
        path.resolve(distDir, "manifest.json")
      );
      fs.copyFileSync(
        path.resolve(rootDir, "aegis-logo.png"),
        path.resolve(distDir, "aegis-logo.png")
      );
    }
  };
}

export default defineConfig({
  plugins: [react(), buildExtensionScripts()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: path.resolve(rootDir, "popup.html"),
        options: path.resolve(rootDir, "options.html")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/chunks/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});

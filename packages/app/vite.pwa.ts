import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { VitePWA } from "vite-plugin-pwa"

export function serviceWorker(directory: string) {
  return [
    {
      // Emitted by this plugin, not copied from public/, so every build that imports it also ships it.
      name: "opencode:notification-service-worker",
      apply: "build" as const,
      async generateBundle(this: { emitFile(file: { type: "asset"; fileName: string; source: string }): string }) {
        this.emitFile({
          type: "asset",
          fileName: "notification-sw.js",
          source: await readFile(resolve(import.meta.dirname, "notification-sw.js"), "utf8"),
        })
      },
    },
    ...VitePWA({
      strategies: "generateSW",
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      workbox: {
        // Workbox runs after Sentry's upload and cleanup, so do not publish an unuploaded map.
        sourcemap: false,
        globDirectory: directory,
        clientsClaim: false,
        // Keep each open tab on its complete build until all old clients close.
        skipWaiting: false,
        inlineWorkboxRuntime: true,
        importScripts: ["/notification-sw.js"],
        navigateFallback: "/index.html",
        // Pairing links must reach the server so it can set the session cookie.
        navigateFallbackDenylist: [/^\/(?:api|auth)(?:\/|$)/, /^\/(?:_assets|assets)(?:\/|$)/],
        // Include lazy chunks and non-JS dependencies, not just the startup bundle.
        globPatterns: ["**/*"],
        globIgnores: ["**/*.map", "_headers", "_redirects"],
        maximumFileSizeToCacheInBytes: Number.MAX_SAFE_INTEGER,
        manifestTransforms: [
          async (entries) => ({
            manifest: await Promise.all(
              entries.map(async (entry) => ({
                ...entry,
                // A revision labels a cache entry; integrity rejects mixed deployments
                // and HTML fallback responses instead of installing a broken build.
                integrity: `sha256-${createHash("sha256")
                  .update(await readFile(resolve(directory, entry.url)))
                  .digest("base64")}`,
              })),
            ),
            warnings: [],
          }),
        ],
      },
    }),
  ]
}

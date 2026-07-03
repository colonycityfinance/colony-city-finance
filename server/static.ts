import express from 'express';
import type { Express } from 'express';
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  // In production on pplx.app, static files are served from S3 — the local
  // public/ directory may not exist. Only serve static files if the dir is present.
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use("/{*path}", (_req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  } else {
    // S3-hosted frontend: API-only mode — static files served by CDN
    console.log("Static dir not found — running in API-only mode (static files served by S3)");
  }
}

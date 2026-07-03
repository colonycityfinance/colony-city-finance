// Load .env but never override env vars already set by the sandbox
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ override: false });
// Also load .env.production in production mode
if (process.env.NODE_ENV === "production") {
  dotenvConfig({ path: ".env.production", override: false });
}
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { initDb } from "./storage";
import { serveStatic } from "./static";
import { createServer } from "node:http";

const app = express();
app.set('trust proxy', 1); // Required behind Cloudflare/pplx.app proxy for rate limiting
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    console.log('Starting Colony City Finance server...');
    console.log('Node version:', process.version, '| CWD:', process.cwd());
    console.log('RESEND_API_KEY present:', !!process.env.RESEND_API_KEY);
    console.log('PPLX_API_KEY present:', !!process.env.PPLX_API_KEY);
    await initDb();
  } catch (err) {
    console.error('FATAL: Database init failed:', err);
    process.exit(1);
  }
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      // Self-ping every 90 seconds to prevent sandbox from going idle
      if (process.env.NODE_ENV === "production") {
        const selfPing = () => {
          const http = require("http");
          const req = http.get(`http://localhost:${port}/api/health`, (res: any) => {
            res.resume(); // drain response
          });
          req.on("error", () => {}); // ignore errors silently
          req.setTimeout(5000, () => req.destroy());
        };
        setInterval(selfPing, 90 * 1000);
        log("Self-ping keep-alive started (every 90s)");
      }
    },
  );
})();

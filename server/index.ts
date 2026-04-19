import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
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
      // Suppress noisy high-frequency polling routes (304s only)
      const isPollingRoute = path === "/api/status" || path === "/api/vault" || path === "/api/files";
      const isNotModified = res.statusCode === 304;
      if (isPollingRoute && isNotModified) return;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // Only log response body for non-200 responses or mutations (POST/PATCH/DELETE)
      if (capturedJsonResponse && (res.statusCode >= 400 || req.method !== "GET")) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
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
  // Port 5000 is used by macOS AirPlay Receiver on Monterey+. Default to 3131.
  const port = parseInt(process.env.PORT || "3131", 10);
  // Use 127.0.0.1 on macOS (0.0.0.0 throws ENOTSUP on some macOS versions).
  // On Linux/Windows 0.0.0.0 is fine, but 127.0.0.1 works everywhere for local use.
  const host = process.env.HOST || "127.0.0.1";
  httpServer.listen(
    { port, host },
    () => {
      log(`serving on http://${host}:${port}`);
    },
  );
})();

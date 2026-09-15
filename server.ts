import 'dotenv/config';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001').split(',');

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3001;
  const isProduction = process.env.NODE_ENV === 'production';

  // --- Security Middleware ---
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProduction
          ? ["'self'"]
          : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
      }
    }
  }));

  app.use(cors({
    origin: (origin, callback) => {
      // Allow no-origin (e.g. curl, server-side) in dev
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  }));

  // --- Rate Limiting ---
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  });

  const scanLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    message: { error: 'Receipt scan rate limit reached. Please try again in an hour.' }
  });

  const aiAskLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30,
    message: { error: 'AI assistant rate limit reached. Please try again in an hour.' }
  });

  app.use(express.json({ limit: '10mb' })); // 10mb to allow base64 receipt images

  // --- API Routes ---
  const { apiRouter } = await import('./src/server/routes.ts');
  app.use('/api/expenses/scan', scanLimiter);
  app.use('/api/ai/ask', aiAskLimiter);
  app.use('/api', apiLimiter, apiRouter);

  // --- Vite Middleware for Development ---
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // --- Production Static Serving ---
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // --- Global Error Handler ---
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[LedgerLink] Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'An unexpected error occurred. Please try again later.' });
    }
  });

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[LedgerLink] Server running on http://127.0.0.1:${PORT}`);
  });
}

startServer();

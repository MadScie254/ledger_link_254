import 'dotenv/config';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // --- Security Middleware ---
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // required for Vite HMR in dev
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

  app.use(express.json({ limit: '10mb' })); // 10mb to allow base64 receipt images

  // --- API Routes ---
  const { apiRouter } = await import('./src/server/routes.ts');
  app.use('/api', apiLimiter, apiRouter);
  app.use('/api/expenses/scan', scanLimiter);

  // --- Vite Middleware for Development ---
  if (process.env.NODE_ENV !== 'production') {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LedgerLink] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

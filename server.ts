import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createApp } from './server/app.js';
import { initDatabase } from './server/db.js';

async function startStandaloneServer() {
  await initDatabase();

  const app = createApp();

  // Vite Middleware (Dev) or Static Dist (Production Hosting)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  const httpServer = app.listen(PORT, '0.0.0.0', 2048, () => {
    console.log(`MKC CBT Server berjalan pada http://0.0.0.0:${PORT}`);
  });
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
  httpServer.requestTimeout = 60000;
}

startStandaloneServer().catch((err) => {
  console.error('Gagal memulai server MKC CBT:', err);
  process.exit(1);
});

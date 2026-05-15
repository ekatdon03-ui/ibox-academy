import express from 'express';
import path from 'path';
import cors from 'cors';
import axios from 'axios';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // ─────────────────────────────────────────────────────────────────────
  // GEMINI API PROXY
  // Forwards all /api/ai-proxy/* requests to Google Generative Language API.
  // The real API key lives ONLY here (server env var), never in the browser bundle.
  // This also bypasses Russian ISP blocks — browser → our server → Google.
  // ─────────────────────────────────────────────────────────────────────
  app.all('/api/ai-proxy*', async (req, res) => {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      return res.status(503).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    try {
      // req.path = /api/ai-proxy/v1beta/models/... → strip prefix
      const proxyPath = req.path.replace('/api/ai-proxy', '') || '/';

      // Rebuild query string, replacing any dummy "key" param with the real one
      const searchParams = new URLSearchParams(req.query as Record<string, string>);
      searchParams.set('key', GEMINI_KEY);

      const targetUrl = `https://generativelanguage.googleapis.com${proxyPath}?${searchParams}`;

      const response = await axios({
        method: req.method as any,
        url: targetUrl,
        data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'x-goog-api-client': 'genai-js/proxy'
        },
        responseType: 'stream',
        timeout: 180_000
      });

      res.status(response.status);
      const ct = response.headers['content-type'];
      if (ct) res.setHeader('Content-Type', ct);

      response.data.pipe(res);
    } catch (error: any) {
      if (error.response) {
        res.status(error.response.status);
        const ct = error.response.headers?.['content-type'];
        if (ct) res.setHeader('Content-Type', ct);
        error.response.data.pipe(res);
      } else {
        console.error('AI proxy error:', error.message);
        res.status(500).json({ error: 'AI proxy failed', details: error.message });
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PROXY FETCH — for AI media extraction (PDFs from Google Drive, etc.)
  // ─────────────────────────────────────────────────────────────────────
  app.post('/api/proxy-fetch', async (req, res) => {
    try {
      let { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL is required' });

      // Convert Google Drive view links to direct download
      if (url.includes('drive.google.com/file/d/')) {
        const fileId = url.split('/d/')[1].split('/')[0];
        url = `https://drive.google.com/uc?export=download&id=${fileId}`;
      } else if (url.includes('drive.google.com/open?id=')) {
        const fileId = url.split('id=')[1].split('&')[0];
        url = `https://drive.google.com/uc?export=download&id=${fileId}`;
      }
      if (url.includes('docs.google.com/presentation/d/')) {
        const docId = url.split('/d/')[1].split('/')[0];
        url = `https://docs.google.com/presentation/d/${docId}/export/pdf`;
      } else if (url.includes('docs.google.com/document/d/')) {
        const docId = url.split('/d/')[1].split('/')[0];
        url = `https://docs.google.com/document/d/${docId}/export?format=pdf`;
      }

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ibox-academy-proxy/1.0)'
        },
        timeout: 30_000
      });

      res.json({
        base64: Buffer.from(response.data).toString('base64'),
        contentType: response.headers['content-type'],
        size: response.data.length
      });
    } catch (error: any) {
      console.error('Proxy fetch error:', error.message);
      res.status(500).json({ error: 'Failed to fetch external content' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // BITRIX24 WEBHOOK RECEIVER
  // ─────────────────────────────────────────────────────────────────────
  app.post('/api/bitrix-webhook', (req, res) => {
    console.log('Bitrix24 Webhook:', JSON.stringify(req.body).substring(0, 200));
    res.json({ success: true });
  });

  // ─────────────────────────────────────────────────────────────────────
  // STATIC / VITE
  // ─────────────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️  GEMINI_API_KEY is not set — AI features will not work!');
    }
  });
}

startServer();

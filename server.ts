import express from 'express';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_PORT = Number(process.env.PYTHON_ENGINE_PORT || 8001);
const PYTHON_URL = `http://127.0.0.1:${PYTHON_PORT}`;
const PORT = 3000;

let pythonProc: ChildProcess | null = null;

function startPythonEngine(): void {
  const engineScript = path.join(__dirname, 'backend', 'engine.py');
  pythonProc = spawn('python3', [engineScript], {
    env: { ...process.env, PYTHON_ENGINE_PORT: String(PYTHON_PORT) },
    stdio: 'inherit',
  });

  pythonProc.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      console.error(`Python engine exited unexpectedly (${code || signal}), restarting in 1s...`);
      setTimeout(startPythonEngine, 1000);
    }
  });
}

async function waitForPythonHealth(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${PYTHON_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Python backend engine failed to start in time');
}

async function main() {
  startPythonEngine();
  await waitForPythonHealth();

  const cleanup = () => {
    if (pythonProc && !pythonProc.killed) {
      pythonProc.kill('SIGTERM');
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const app = express();

  app.use('/api', express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
    const targetUrl = `${PYTHON_URL}${req.originalUrl}`;
    const headers: Record<string, string> = {};
    if (req.headers.authorization) headers['authorization'] = String(req.headers.authorization);
    if (req.headers['content-type']) headers['content-type'] = String(req.headers['content-type']);

    try {
      const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase()) && Buffer.isBuffer(req.body) && req.body.length > 0;
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
      });

      const contentType = upstream.headers.get('content-type') || 'application/json';
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status).setHeader('Content-Type', contentType).send(buf);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Python engine proxy error' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist', 'index.html'));

  if (isProd) {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GammaDesk server listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

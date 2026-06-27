import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../config.js';
import router from './routes.js';

export function startWebapp(): void {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  app.use(router);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'invester-drive', timestamp: new Date().toISOString() });
  });

  const port = config.webapp.port;
  app.listen(port, () => {
    console.log(`InvesterDrive running on http://localhost:${port}`);
  });
}

// When run directly via `npm run webapp`
const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  startWebapp();
}

/**
 * Browser tab icons for Wallet Street WebUI.
 *
 * Assets live in `webui/` (also served as domain static under
 * `/domain-assets/invage/`). Root routes cover auto-discovery:
 * `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`.
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Router, type Request, type Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WEBUI_DIR = join(__dirname, '../../webui');

function sendAsset(file: string, contentType: string) {
  return (_req: Request, res: Response): void => {
    const path = join(WEBUI_DIR, file);
    if (!existsSync(path)) {
      res.status(500).type('text/plain').send(`Missing favicon asset: ${file}`);
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path);
  };
}

/** Mount at `/` so browsers auto-discover `/favicon.ico`. */
export function createFaviconRouter(): Router {
  const router = Router();
  router.get('/favicon.ico', sendAsset('favicon.ico', 'image/x-icon'));
  router.get('/favicon.svg', sendAsset('favicon.svg', 'image/svg+xml'));
  router.get('/favicon-32.png', sendAsset('favicon-32.png', 'image/png'));
  router.get('/favicon-16.png', sendAsset('favicon-16.png', 'image/png'));
  router.get('/apple-touch-icon.png', sendAsset('apple-touch-icon.png', 'image/png'));
  router.get('/apple-touch-icon', sendAsset('apple-touch-icon.png', 'image/png'));
  return router;
}

export function faviconWebUiDir(): string {
  return WEBUI_DIR;
}

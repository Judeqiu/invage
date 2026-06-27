import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../config.js';
import router from './routes.js';

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

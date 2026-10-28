import './lib/env.js';
import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', healthRouter);

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));

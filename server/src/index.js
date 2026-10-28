import './lib/env.js';
import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';
import guidesRouter from './routes/guides.js';
import generateRouter from './routes/generate.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', healthRouter);
app.use('/api', guidesRouter);
app.use('/api', generateRouter);

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));

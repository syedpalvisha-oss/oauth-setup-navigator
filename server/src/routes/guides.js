import { Router } from 'express';
import { getGuide, listGuides } from '../lib/guides.js';

const router = Router();

router.get('/guides', (_req, res) => res.json(listGuides()));

router.get('/guides/:slug', (req, res) => {
  const guide = getGuide(req.params.slug);
  if (!guide) return res.status(404).json({ error: `No guide found for "${req.params.slug}"` });
  res.json(guide);
});

export default router;

import { Router } from 'express';
import { buildAiUsageReport, clearProviderCooldown } from '../services/ai-usage.service.js';

const router = Router();
router.get('/', async (req, res, next) => {
  try { res.json({ success: true, data: await buildAiUsageReport(req.query) }); } catch (error) { next(error); }
});
router.post('/:provider/unblock', async (req, res, next) => {
  try {
    if (!['claude', 'openai', 'gemini'].includes(req.params.provider)) return res.status(400).json({ success: false, error: 'Provedor inválido' });
    res.json({ success: true, data: await clearProviderCooldown(req.params.provider) });
  } catch (error) { next(error); }
});
export default router;

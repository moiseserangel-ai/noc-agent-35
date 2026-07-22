import { Router } from 'express';
import { getBranding } from '../services/branding.service.js';

const router = Router();
router.get('/', async (_req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json({ success: true, data: await getBranding() }); } catch (error) { next(error); }
});
export default router;

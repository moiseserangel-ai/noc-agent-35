import { Router } from 'express';
import { buildIncidentReport } from '../services/report.service.js';

const router = Router();
router.get('/incidents', async (req, res, next) => { try { res.json({ success: true, data: await buildIncidentReport(req.query,req.user.tenantId) }); } catch (error) { next(error); } });
export default router;

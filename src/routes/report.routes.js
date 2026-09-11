import { Router } from 'express';
import { buildIncidentReport } from '../services/report.service.js';
import prisma from '../database/client.js';
import { generateMonthlyReport, monthlyReportPdf, validateMonthlyReportConfig } from '../services/monthly-report.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';

const router = Router();
router.get('/incidents', async (req, res, next) => { try { res.json({ success: true, data: await buildIncidentReport(req.query,req.user.tenantId) }); } catch (error) { next(error); } });

const globalAdmin = (req, res) => !req.user.tenantId && req.user.role === 'admin' ? true : (res.status(403).json({ success: false, error: 'Operação restrita ao administrador global' }), false);
const publicRun = run => ({ ...run, reportData: undefined, deliveryLog: run.deliveryLog ? JSON.parse(run.deliveryLog) : [] });

router.get('/monthly', async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId || String(req.query.tenantId || '') || undefined;
    const rows = await prisma.monthlyReportRun.findMany({
      where: { ...(tenantId && { tenantId }) },
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 50, 200),
    });
    res.json({ success: true, data: rows.map(publicRun) });
  } catch (error) { next(error); }
});

router.put('/monthly/tenants/:tenantId', async (req, res, next) => {
  try {
    if (!globalAdmin(req, res)) return;
    const config = validateMonthlyReportConfig(req.body);
    const tenant = await prisma.tenant.update({ where: { id: req.params.tenantId }, data: config });
    await logAudit({ ...requestIdentity(req), action: 'update', resource: 'monthly_report_schedule', resourceId: tenant.id, details: config });
    res.json({ success: true, data: tenant, message: 'Programação mensal atualizada' });
  } catch (error) { next(error); }
});

router.post('/monthly/tenants/:tenantId/run', async (req, res, next) => {
  try {
    if (!globalAdmin(req, res)) return;
    const run = await generateMonthlyReport(req.params.tenantId);
    await logAudit({ ...requestIdentity(req), action: 'execute', resource: 'monthly_report', resourceId: run.id, status: run.status === 'failed' ? 'failure' : 'success', details: { tenantId: run.tenantId, periodKey: run.periodKey, status: run.status } });
    res.status(201).json({ success: true, data: publicRun(run), message: 'Relatório mensal gerado e entregue' });
  } catch (error) { next(error); }
});

router.get('/monthly/:id/pdf', async (req, res, next) => {
  try {
    const run = await prisma.monthlyReportRun.findFirst({ where: { id: req.params.id, ...(req.user.tenantId && { tenantId: req.user.tenantId }) }, include: { tenant: { select: { name: true, slug: true } } } });
    if (!run) return res.status(404).json({ success: false, error: 'Relatório não encontrado' });
    const pdf = await monthlyReportPdf(run);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="relatorio-${run.tenant.slug}-${run.periodKey}.pdf"`);
    res.send(pdf);
  } catch (error) { next(error); }
});
export default router;

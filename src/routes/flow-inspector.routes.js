import { Router } from "express";
import {
  classifyFlowAnomaly,
  collectFlowObservation,
  deleteFlowCustomRule,
  deleteFlowSilence,
  flowInspectorDashboard,
  flowSecurityCsv,
  flowSecurityReport,
  getFlowRetentionPolicy,
  getFlowRecurrenceConfig,
  getFlowExporterHealthConfig,
  getFlowSecurityProfiles,
  listFlowCustomRules,
  listFlowNotifications,
  listFlowSilences,
  previewFlowRetention,
  retryFlowNotification,
  saveFlowCustomRule,
  saveFlowRecurrenceConfig,
  saveFlowRetentionPolicy,
  saveFlowExporterHealthConfig,
  saveFlowSecurityProfile,
  saveFlowSilence,
  searchFlowTraffic,
  testFlowCustomRule,
  testFlowInspector,
  executeFlowRetention,
} from "../services/flow-inspector.service.js";
import {
  approveFlowMitigation,
  approveFlowMitigationBatch,
  listFlowMitigations,
  prepareFlowMitigation,
  prepareFlowMitigationBatch,
} from "../services/flow-mitigation.service.js";
import {
  getFlowIntegration,
  rotateFlowPassword,
  saveFlowIntegration,
  testFlowIntegration,
} from "../services/flow-integration.service.js";
import { getIpReputation } from "../services/ip-reputation.service.js";
const router = Router();
router.get("/integration", async (req, res, next) => {
  try {
    res.json({ success: true, data: await getFlowIntegration() });
  } catch (error) {
    next(error);
  }
});
router.post("/integration/test", async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await testFlowIntegration(req.body),
      message: "Conexão com ClickHouse validada",
    });
  } catch (error) {
    next(error);
  }
});
router.put("/integration", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res
        .status(403)
        .json({
          success: false,
          error: "Somente administradores podem alterar a integração",
        });
    res.json({
      success: true,
      data: await saveFlowIntegration(req.body),
      message: "Integração atualizada",
    });
  } catch (error) {
    next(error);
  }
});
router.post("/integration/rotate-password", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res
        .status(403)
        .json({
          success: false,
          error: "Somente administradores podem trocar a senha",
        });
    res.json({
      success: true,
      data: await rotateFlowPassword(req.body.password),
      message: "Senha trocada e validada nos dois serviços",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/", async (req, res, next) => {
  try {
    res.json({ success: true, data: await flowInspectorDashboard() });
  } catch (error) {
    next(error);
  }
});
router.post("/collect", async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await collectFlowObservation(),
      message: "Amostra de tráfego coletada",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/test", async (req, res, next) => {
  try {
    res.json({ success: true, data: await testFlowInspector() });
  } catch (error) {
    next(error);
  }
});
router.post("/reputation/:ip", async (req,res,next)=>{
  try { res.json({success:true,data:await getIpReputation(req.params.ip),message:"Reputação consultada e armazenada em cache"}); }
  catch(error){ next(error); }
});
router.get("/search", async (req, res, next) => {
  try {
    res.json({ success: true, data: await searchFlowTraffic(req.query) });
  } catch (error) {
    next(error);
  }
});
router.get("/profiles", async (req, res, next) => {
  try {
    const dashboard = await flowInspectorDashboard(),
      names = dashboard.exporters.map((row) => row.exporterName);
    res.json({ success: true, data: await getFlowSecurityProfiles(names) });
  } catch (error) {
    next(error);
  }
});
router.put("/profiles/:exporter", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem alterar perfis de segurança",
      });
    res.json({
      success: true,
      data: await saveFlowSecurityProfile(req.params.exporter, req.body),
      message: "Perfil de segurança atualizado",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/rules", async (req, res, next) => {
  try {
    res.json({ success: true, data: await listFlowCustomRules() });
  } catch (error) {
    next(error);
  }
});
router.post("/rules/test", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem testar regras",
      });
    res.json({
      success: true,
      data: await testFlowCustomRule(req.body),
      message: "Teste concluído sem gerar notificações",
    });
  } catch (error) {
    next(error);
  }
});
router.post("/rules", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem criar regras",
      });
    res.status(201).json({
      success: true,
      data: await saveFlowCustomRule(req.body),
      message: "Regra personalizada salva em modo observação",
    });
  } catch (error) {
    next(error);
  }
});
router.delete("/rules/:id", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem excluir regras",
      });
    res.json({
      success: true,
      data: await deleteFlowCustomRule(req.params.id),
      message: "Regra removida",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/silences", async (req, res, next) => {
  try {
    res.json({ success: true, data: await listFlowSilences() });
  } catch (error) {
    next(error);
  }
});
router.post("/silences", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem programar silenciamentos",
      });
    res.status(201).json({
      success: true,
      data: await saveFlowSilence(req.body, req.user.username),
      message: "Janela de silenciamento programada",
    });
  } catch (error) {
    next(error);
  }
});
router.delete("/silences/:id", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem remover silenciamentos",
      });
    res.json({
      success: true,
      data: await deleteFlowSilence(req.params.id),
      message: "Silenciamento removido",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/notifications", async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await listFlowNotifications(req.query.limit),
    });
  } catch (error) {
    next(error);
  }
});
router.post("/notifications/:id/retry", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem reenviar notificações",
      });
    res.json({
      success: true,
      data: await retryFlowNotification(req.params.id, req.user.username),
      message: "Notificação reenviada",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/recurrence", async (req, res, next) => {
  try {
    res.json({ success: true, data: await getFlowRecurrenceConfig() });
  } catch (error) {
    next(error);
  }
});
router.put("/recurrence", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem alterar a recorrência",
      });
    res.json({
      success: true,
      data: await saveFlowRecurrenceConfig(req.body),
      message: "Controle de recorrência atualizado",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/exporter-health", async (req, res, next) => {
  try {
    res.json({ success: true, data: await getFlowExporterHealthConfig() });
  } catch (error) {
    next(error);
  }
});
router.put("/exporter-health", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem alterar a saúde dos exportadores",
      });
    res.json({
      success: true,
      data: await saveFlowExporterHealthConfig(req.body),
      message: "Monitoramento dos exportadores atualizado",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/retention", async (req, res, next) => {
  try {
    res.json({ success: true, data: await previewFlowRetention() });
  } catch (error) {
    next(error);
  }
});
router.put("/retention", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem alterar a retenção",
      });
    res.json({
      success: true,
      data: await saveFlowRetentionPolicy(req.body),
      message: "Política de retenção atualizada",
    });
  } catch (error) {
    next(error);
  }
});
router.post("/retention/execute", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem executar a limpeza",
      });
    res.json({
      success: true,
      data: await executeFlowRetention(),
      message: "Retenção executada",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/reports/security", async (req, res, next) => {
  try {
    res.json({ success: true, data: await flowSecurityReport(req.query) });
  } catch (error) {
    next(error);
  }
});
router.get("/reports/security.csv", async (req, res, next) => {
  try {
    const buffer = await flowSecurityCsv(req.query);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="netflow-seguranca-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});
router.post("/anomalies/:id/classify", async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await classifyFlowAnomaly(req.params.id, {
        ...req.body,
        username: req.user.username,
      }),
      message: "Anomalia classificada",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/mitigations", async (req, res, next) => {
  try {
    res.json({ success: true, data: await listFlowMitigations() });
  } catch (error) {
    next(error);
  }
});
router.post("/anomalies/:id/mitigation", async (req, res, next) => {
  try {
    res.status(201).json({
      success: true,
      data: await prepareFlowMitigation(req.params.id, {
        ...req.body,
        username: req.user.username,
      }),
      message: "Proposta de mitigação preparada para revisão",
    });
  } catch (error) {
    next(error);
  }
});
router.post("/mitigations/batch/prepare",async(req,res,next)=>{try{res.status(201).json({success:true,data:await prepareFlowMitigationBatch(req.body.anomalyIds,{durationMinutes:req.body.durationMinutes,username:req.user.username}),message:"Proposta em lote preparada para revisão"})}catch(error){next(error)}});
router.post("/mitigations/batch/approve",async(req,res,next)=>{try{if(req.user.role!=="admin")return res.status(403).json({success:false,error:"Somente administradores podem executar mitigação em lote"});res.json({success:true,data:await approveFlowMitigationBatch(req.body.mitigationIds,{username:req.user.username,confirmed:req.body.confirmed}),message:"Mitigação em lote aplicada e validada"})}catch(error){next(error)}});
router.post("/mitigations/:id/approve", async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({
        success: false,
        error: "Somente administradores podem executar mitigação",
      });
    res.json({
      success: true,
      data: await approveFlowMitigation(req.params.id, {
        username: req.user.username,
        confirmed: req.body.confirmed,
      }),
      message: "Mitigação temporária aplicada e validada",
    });
  } catch (error) {
    next(error);
  }
});
export default router;

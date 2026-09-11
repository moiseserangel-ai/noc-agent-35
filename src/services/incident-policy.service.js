import prisma from '../database/client.js';

const VALID_MODES = new Set(['manual', 'hybrid', 'automatic']);

export function shouldAutoDiagnoseIncident(priority, mode = 'hybrid') {
  if (mode === 'automatic') return true;
  if (mode === 'manual') return false;
  return ['high', 'critical'].includes(priority);
}

export async function getIncidentAutomationMode() {
  const setting = await prisma.settings.findUnique({ where: { key: 'ai_incident_mode' } });
  return VALID_MODES.has(setting?.value) ? setting.value : 'hybrid';
}

export function describeIncidentPolicy(mode, priority) {
  if (mode === 'manual') return 'Modo manual: diagnóstico por IA somente quando solicitado pelo operador.';
  if (mode === 'automatic') return 'Modo automático: diagnóstico por IA iniciado para o alerta.';
  return ['high', 'critical'].includes(priority)
    ? 'Modo híbrido: severidade alta/crítica, diagnóstico automático iniciado.'
    : 'Modo híbrido: Task criada sem consumo de IA. Use “Reprocessar com agente” se desejar análise.';
}

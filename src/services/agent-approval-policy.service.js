const APPROVAL_SIGNAL = /responda\s+com(?:\s|[*_`])+sim|\b(?:sim|aprovar)\b[\s\S]{0,80}\b(?:aplicar|executar|remo[cç][aã]o|altera[cç][aã]o)\b|comandos?\s*\([^)]*sem\s+executar\s+nesta\s+fase[^)]*\)|\bsem\s+executar\s+nesta\s+fase\b|aguardando\s+aprova[cç][aã]o|modo\s+(?:de\s+)?somente\s+leitura|bloqueio\s+(?:de|para)\s+(?:comandos\s+de\s+)?altera[cç][aã]o|comando\s+de\s+altera[cç][aã]o\s+bloqueado/i;

export function specialistResultNeedsApproval(workType, text = '') {
  return workType === 'configuration' || APPROVAL_SIGNAL.test(String(text));
}

export function proposalQualityWarnings(workType, text = '') {
  if (workType !== 'configuration') return [];
  const value = String(text || '').toLowerCase();
  const required = [['evidências', 'evidências coletadas'], ['diagnóstico', 'diagnostico'], ['plano', 'plano'], ['risco', 'impacto'], ['validação', 'validacao'], ['rollback', 'reversão']];
  return required.filter(([, ...terms]) => !terms.some(term => value.includes(term))).map(([label]) => `Seção ausente: ${label}`);
}

export function configurationPlanningInstruction(workType, taskNumber) {
  if (workType !== 'configuration') return '';
  return `

## FLUXO OBRIGATÓRIO DE MUDANÇA
Esta é uma solicitação de CONFIGURAÇÃO na fase de planejamento da #TASK-${taskNumber}.
- Use as tools somente para coletar evidências com comandos de leitura.
- NÃO tente executar comandos de alteração nesta fase e NÃO diga que falta permissão.
- Apresente a mudança proposta, comandos exatos, impacto, risco, validação e rollback.
- Termine obrigatoriamente com: "Responda com SIM para aplicar ou NÃO para cancelar. #TASK-${taskNumber}"
A alteração será executada pelo sistema em uma segunda etapa, somente após a aprovação humana.`;
}

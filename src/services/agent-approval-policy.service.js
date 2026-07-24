const APPROVAL_SIGNAL = /responda\s+com\s+sim|aguardando\s+aprova[cç][aã]o|modo\s+(?:de\s+)?somente\s+leitura|bloqueio\s+(?:de|para)\s+(?:comandos\s+de\s+)?altera[cç][aã]o|comando\s+de\s+altera[cç][aã]o\s+bloqueado/i;

export function specialistResultNeedsApproval(workType, text = '') {
  return workType === 'configuration' || APPROVAL_SIGNAL.test(String(text));
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

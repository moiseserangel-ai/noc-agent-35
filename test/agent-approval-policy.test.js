import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationPlanningInstruction, specialistResultNeedsApproval } from '../src/services/agent-approval-policy.service.js';

test('toda configuração exige aprovação mesmo sem frase do modelo', () => {
  assert.equal(specialistResultNeedsApproval('configuration', 'Configuração preparada.'), true);
  assert.equal(specialistResultNeedsApproval('consultation', 'Consulta concluída.'), false);
});

test('resposta bloqueada nunca é marcada como resolvida', () => {
  assert.equal(specialistResultNeedsApproval('consultation', 'A sessão está em modo somente leitura.'), true);
  assert.equal(specialistResultNeedsApproval('consultation', 'Comando de alteração bloqueado.'), true);
});

test('instrução de planejamento impede tentativa antecipada e inclui a Task', () => {
  const instruction = configurationPlanningInstruction('configuration', 73);
  assert.match(instruction, /NÃO tente executar comandos de alteração/);
  assert.match(instruction, /#TASK-73/);
  assert.equal(configurationPlanningInstruction('consultation', 73), '');
});

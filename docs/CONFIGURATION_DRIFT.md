# Configuration drift

## Objetivo

O módulo identifica alterações externas comparando cada coleta manual ou automática com um baseline explicitamente aprovado. A detecção é somente leitura: nenhum comando de correção é enviado ao equipamento.

## Fluxo

1. A primeira configuração válida torna-se o baseline inicial.
2. Coletas seguintes são comparadas ao baseline, e não apenas ao snapshot anterior.
3. Uma divergência abre uma única ocorrência e uma Task. Novas coletas atualizam essa ocorrência sem criar Tasks duplicadas.
4. **Reconhecer** registra que o NOC analisou o evento, mas mantém a ocorrência aberta.
5. **Confirmar correção** solicita uma nova coleta. A ocorrência só é encerrada se o conteúdo corresponder ao baseline.
6. Se a divergência continuar, a Task permanece aberta com a evidência mais recente.
7. **Aceitar baseline** registra a decisão administrativa e promove o snapshot divergente a novo baseline.

## Mudanças controladas

Snapshots posteriores a Change Requests e Runbooks somente viram baseline quando a execução e sua validação terminam com sucesso. Uma falha de execução ou compliance não promove a configuração observada.

## Proteções

- Conteúdo criptografado com AES-256-GCM.
- Integridade verificada por SHA-256.
- Baseline ativo e snapshots vinculados a evidências de drift não podem ser excluídos.
- A retenção automática preserva o baseline.
- Decisões e promoções são registradas na auditoria.
- O script `scripts/initialize-config-baselines.mjs` é idempotente e serve para inicializar ambientes existentes.

## Operação recomendada

- Mantenha backup automático diário nos equipamentos críticos.
- Revise as linhas adicionadas e removidas antes de aceitar um baseline.
- Use **Confirmar correção** somente depois de corrigir o equipamento.
- Aceite um novo baseline apenas quando a mudança for conhecida e autorizada.

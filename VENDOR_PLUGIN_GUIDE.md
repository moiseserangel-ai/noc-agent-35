# Plugins de especialistas por fabricante

O núcleo resolve especialistas pelo `Device.type`. Cada plugin publicado em
`src/vendors/registry.js` declara tipo, nome, fabricante, plataforma e classe do
agente. O catálogo público alimenta automaticamente o cadastro e o seletor do chat.

## Contrato mínimo

Um especialista deve implementar:

- `diagnose(deviceId, deviceName, request, taskNumber)` para consultas sem alteração;
- `executeSolution(deviceId, deviceName, solution, taskNumber)` protegido por
  `withApprovedRemediation`;
- uma tool de transporte que valide o tipo do equipamento;
- uma lista positiva de comandos de leitura;
- bloqueio permanente de operações destrutivas;
- coleta de evidências, risco, aplicação, rollback e validação no prompt.

## Adicionando um fabricante

1. Criar `src/tools/ssh-<tipo>.tool.js` ou outro transporte apropriado.
2. Criar `src/agents/<tipo>-agent.js` com o contrato acima.
3. Registrar o plugin em `src/vendors/registry.js`.
4. Adicionar testes de leitura, aprovação e comandos permanentemente bloqueados.
5. Validar inicialmente em modo somente leitura em equipamento de laboratório.
6. Liberar alterações por grupos de comandos após homologação e rollback testado.

Não coloque credenciais, configurações reais ou documentação confidencial no
prompt. Esses dados devem permanecer no banco criptografado ou em uma futura base
de conhecimento com controle de acesso.

## Huawei VRP / NetEngine

O primeiro plugin de rede extensível utiliza SSH interativo, desativa paginação e
reconhece prompts VRP. Em diagnóstico aceita `display`, `ping` e `tracert`.
Alterações são liberadas somente dentro do contexto de remediação aprovada.
`reboot`, `reset saved-configuration`, `format` e troca de system software ficam
bloqueados mesmo após aprovação.

Antes de liberar mudanças reais, cadastre modelo, versão do VRP e capacidades do
equipamento e homologue o comportamento de `system-view`, `commit` e rollback na
versão utilizada.

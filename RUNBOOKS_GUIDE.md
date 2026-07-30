# Catálogo de Runbooks

O catálogo reúne automações operacionais reutilizáveis para os equipamentos cadastrados no NOC Agent.

## Biblioteca de modelos

A opção **Biblioteca** oferece modelos de diagnóstico somente leitura para MikroTik, Huawei VRP, Cisco IOS, Juniper Junos, FortiGate, EdgeOS, Datacom DMOS, Nokia SR OS e Linux. A importação cria um rascunho independente: revise comandos e variáveis conforme a versão do equipamento antes de publicar.

## Ciclo de vida

1. O administrador cria um rascunho.
2. Cada edição incrementa a versão e retorna o runbook ao estado de rascunho.
3. O administrador revisa e publica.
4. Administradores e operadores podem simular.
5. Somente administradores podem confirmar a execução ou o rollback.

Uma execução real exige uma simulação com o mesmo runbook, equipamento e valores de variáveis nos últimos 30 minutos.

## Aprovação em duas etapas

Runbooks somente de consulta são classificados como baixo risco e podem ser publicados diretamente. Runbooks com comandos de alteração e rollback são de alto risco; alterações sem rollback ou comandos que não possam ser classificados são críticos.

Runbooks de alto risco ou críticos exigem aprovação independente. O administrador que criou, editou ou solicitou a aprovação não pode aprovar nem rejeitar a própria versão. Qualquer edição invalida a aprovação anterior e inicia uma nova revisão.

## Etapas

Cada etapa possui:

- comando principal;
- comando opcional de validação;
- comando opcional de rollback;
- opção de continuar ou interromper após falha.

Os comandos passam pela mesma classificação e pelas mesmas proteções do Terminal CLI. Mudanças são executadas dentro do contexto de remediação aprovado e registradas na auditoria do sistema.

## Variáveis

As chaves devem começar com letra minúscula e podem conter letras, números e `_`. Use `{{chave}}` dentro dos comandos. Uma expressão regular pode validar o valor antes da simulação.

Não cadastre senhas, tokens ou outras credenciais como variáveis de runbook. Os dados renderizados e os resultados são criptografados no banco, mas ficam visíveis aos usuários autorizados no histórico operacional.

## Estados e evidências

Runbooks podem estar em `draft`, `published` ou `archived`. Cada simulação, execução e rollback registra solicitante, equipamento, versão, comandos renderizados, resultados, horário e estado final.

## Integração assistida com incidentes

Ao abrir uma Task de incidente vinculada a um equipamento, o sistema procura Runbooks publicados compatíveis com o fabricante. A classificação considera o texto do alerta, o diagnóstico, a categoria e termos como interface, rota, firewall, latência, CPU, memória, disco e serviço.

O operador pode preencher variáveis e simular diretamente na Task. A simulação não executa comandos e fica registrada na linha do tempo. Um administrador pode confirmar a execução dos mesmos valores durante 30 minutos; a Task permanece aberta até que um usuário valide a recuperação e conclua o incidente.

## Agendamentos e recorrência

Administradores podem criar agendas diárias ou semanais para um Runbook publicado e um equipamento ativo. O horário usa um fuso IANA explícito, por padrão `America/Porto_Velho`, e cada execução fica vinculada ao agendamento.

O modo **Somente simular** é permitido para qualquer Runbook publicado. O modo **Simular e executar automaticamente** exige confirmação administrativa no cadastro e é limitado a Runbooks de baixo risco. Runbooks de alto risco ou críticos nunca executam mudanças de forma autônoma. Agendas podem ser pausadas, reativadas ou excluídas.

## Execução em lote

Um lote aplica o mesmo Runbook e conjunto de variáveis a equipamentos selecionados manualmente ou por grupo. São aceitos de 2 a 50 equipamentos compatíveis.

Administradores e operadores podem criar e simular lotes. A execução real exige administrador e confirmação explícita, usa no máximo 3 conexões simultâneas e interrompe novas ondas quando as falhas atingem 20% dos equipamentos já processados. Equipamentos restantes são marcados como ignorados, preservando o resultado individual e o resumo do lote.

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

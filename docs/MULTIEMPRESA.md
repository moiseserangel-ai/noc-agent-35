# Operação multiempresa

## Perfis e escopos

O NOC Agent separa a equipe global dos usuários vinculados a uma empresa. Perfis globais (`admin`, `operator`, `viewer`) nunca devem possuir `tenantId`. Perfis de empresa exigem uma empresa vinculada:

- `tenant_admin`: administra usuários e equipamentos da própria empresa, opera Tasks, consulta relatórios e executa análises de vulnerabilidades do seu inventário.
- `tenant_operator`: consulta equipamentos e opera Tasks da própria empresa.
- `tenant_viewer`: acesso somente leitura aos equipamentos, Tasks, relatórios e documentação da própria empresa.

O administrador da empresa não recebe acesso às configurações globais, integrações, credenciais, auditoria global, terminal, Chat IA, backups, NetFlow ou dados de outras empresas.

## Isolamento aplicado

O `tenantId` da sessão autenticada prevalece sobre filtros enviados pelo navegador. Consultas de equipamentos, Tasks, relatórios e vulnerabilidades usam esse escopo. Acesso direto a um identificador pertencente a outra empresa responde como recurso não encontrado.

Um `tenant_admin` pode listar, criar, editar, redefinir senha, ativar e excluir apenas usuários vinculados à própria empresa. Ele não pode transferir usuários de escopo, criar administradores globais nem remover o próprio acesso administrativo.

## Administração global

Somente o `admin` global cadastra empresas, altera contratos do portal, configura integrações, gerencia credenciais e acessa módulos globais. Ao vincular um usuário a uma empresa, selecione obrigatoriamente um dos perfis `tenant_*`.

## Implantação gradual

O núcleo do CMDB/IPAM está disponível ao `tenant_admin`: ativos, inventário individual, interfaces, VLANs, sub-redes e endereços são filtrados pelo `tenantId` da sessão. Parâmetros enviados pelo navegador não podem substituir esse escopo, e operações por ID validam a propriedade do recurso.

Descoberta e reconciliação automáticas, ciclo de vida global, relacionamentos, serviços de negócio e coleta geral permanecem bloqueados no portal da empresa enquanto suas rotinas internas não estiverem integralmente isoladas.

Compliance, mudanças, runbooks, Chat IA, terminal e NetFlow permanecem globais até que todas as operações internas desses módulos aceitem e validem `tenantId`. Não remova essa restrição apenas na interface: o isolamento deve existir primeiro no backend e receber testes contra acesso cruzado.
## Mapa e capacidade

- O mapa mostra apenas equipamentos da empresa autenticada e enlaces cujas duas pontas pertencem à mesma empresa.
- A telemetria de enlaces valida a propriedade das duas pontas.
- Capacidade, disponibilidade e exportação CSV são filtradas pela empresa autenticada.
- Coleta global, descoberta, edição do mapa, snapshots e exportação PDF permanecem exclusivas do administrador da plataforma.

## Compliance

- O administrador da empresa pode executar verificações somente nos seus equipamentos, configurar suas políticas, consultar evidências, administrar exceções e criar Tasks de correção.
- Painel, histórico de verificações e relatórios CSV/PDF são filtrados pelo `tenantId` da sessão, inclusive quando um identificador é enviado diretamente na URL.
- Perfis padrão podem ser consultados para aplicação nas políticas, mas sua criação ou alteração permanece global.
- Governança organizacional, pacote de auditoria com cadeia global e exclusão de resultados permanecem exclusivos do administrador da plataforma.

## Mudanças e Runbooks

- Mudanças são isoladas pelos equipamentos associados. Uma RFC de empresa só pode referenciar equipamentos e Tasks da própria empresa.
- O administrador da empresa pode aprovar ou rejeitar a RFC e solicitar rollback; operadores da empresa podem acompanhar o fluxo operacional.
- Runbooks publicados são um catálogo global somente leitura para as empresas. Criação, edição, publicação, biblioteca e versionamento administrativo permanecem globais.
- Simulações, execuções, métricas, histórico e comparação de configuração são filtrados pelos equipamentos da empresa.
- O administrador da empresa pode executar um Runbook publicado somente após uma simulação idêntica válida e confirmação explícita.
- Lotes e agendamentos permanecem globais nesta etapa, pois seus modelos atuais não possuem vínculo direto com `tenantId`.

## Chat IA e Base de Conhecimento

- Cada nova conversa pertence ao usuário e à empresa autenticada. Conversas, mensagens, anexos, exportações e feedback não podem ser acessados por outro usuário ou empresa.
- Conversas globais antigas sem proprietário são assumidas pelo primeiro usuário global que voltar a utilizá-las; elas nunca são apresentadas no portal de uma empresa.
- O suporte e os especialistas só localizam equipamentos da empresa da sessão. Chamadas de ferramentas com outro `deviceId`, ping ou traceroute fora do inventário autorizado são bloqueadas.
- A recuperação documental combina documentos globais ativos com documentos privados da empresa. Documentos de outra empresa nunca participam da busca.
- O administrador da empresa pode enviar, atualizar, classificar e remover apenas documentos privados da própria empresa; documentos globais são somente leitura.
- Cada uso de provedor registra o `tenantId`. Limites mensais de solicitações e tokens podem ser configurados em **Contratos e Portais**; valor zero significa sem limite.
- Chaves, modelos, fallback e estado dos provedores continuam sob administração exclusiva da equipe global.

# Clientes e Multi-Tenancy

O NOC Agent diferencia dois escopos:

- **Equipe global do NOC:** usuários sem cliente vinculado; podem administrar toda a plataforma.
- **Portal do cliente:** usuários vinculados a um cliente; visualizam somente equipamentos, Tasks e relatórios do próprio cliente.

## Configuração

1. Acesse **Clientes** e crie a organização.
2. Cadastre suas unidades.
3. Vincule os equipamentos ao cliente e, opcionalmente, à unidade.
4. Em **Usuários**, crie ou edite um acesso escolhendo o cliente.
5. O usuário deve entrar novamente após qualquer mudança de escopo.

Ao vincular um equipamento, as Tasks históricas desse equipamento também recebem o cliente. Novas Tasks herdam automaticamente o cliente do equipamento.

## Segurança

O isolamento é aplicado no backend, não apenas no menu. Tokens carregam o identificador do cliente e a autenticação o reconfirma no banco em cada requisição. Usuários de cliente são bloqueados nos módulos globais, incluindo Configurações, IA, Terminal, Backups, Compliance, Runbooks, Auditoria, Notificações, Plantão e gestão da Status Page.

Registros antigos permanecem no escopo global até que seus equipamentos sejam associados. Usuários existentes também continuam globais para preservar o funcionamento atual.

## SLA contratual

Cada cliente pode definir prazos de reconhecimento e resolução para as prioridades baixa, média, alta e crítica. Campos não preenchidos herdam a política global. Novas Tasks e Tasks reabertas calculam seus vencimentos usando o contrato do cliente vinculado ao equipamento.

## Status Page individual

Serviços vinculados a equipamentos de cliente são publicados separadamente em `/status/identificador-do-cliente`. O título, a descrição e a cor primária pertencem ao cliente. A página global não mistura serviços de clientes, e a página individual nunca retorna serviços ou incidentes de outro cliente.

## Notificações e plantão

Cada equipe de plantão possui um escopo: global ou um cliente específico. Configure em **Escopos de Plantão**. Durante o escalonamento, o sistema consulta somente equipes com o mesmo `tenantId` da Task; contatos de outros clientes nunca entram na lista de entrega. Regras de notificação seguem o mesmo isolamento.

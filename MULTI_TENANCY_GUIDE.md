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

# NOC Agent 35 — Runbook de produção

## Arquitetura implantada

- CT 105: Zabbix e PostgreSQL.
- CT 106: Evolution API.
- CT 107: NOC Agent, Nginx, Node.js e SQLite.
- Aplicação: `/opt/noc-agent`.
- Banco: `/opt/noc-agent/prisma/data/noc-agent.db`.
- Backups: `/opt/noc-agent/backups`.
- Serviço: `noc-agent.service`, usuário restrito `nocagent`.

## Verificação rápida

```bash
cd /opt/noc-agent
npm test
npm run check:production
systemctl status noc-agent --no-pager
nginx -t
curl -fsS http://127.0.0.1:3000/api/health
```

Todos os itens de `check:production` devem retornar `OK`.

## Operação diária

- Acompanhar incidentes e SLA no Dashboard.
- Conferir falhas de envio em Auditoria.
- Conferir a data do último backup no Dashboard.
- Validar mensalmente o download de um backup.
- Revisar sessões e ativar 2FA em **Minha segurança**.
- Manter ao menos dois provedores de IA configurados para fallback.

## Backup e restauração

Use **Backup e restauração** no painel. Antes de restaurar, o sistema valida o SQLite, cria uma cópia pré-restauração e reinicia o serviço. Não copie manualmente o banco enquanto houver escrita; use o painel ou `createBackup()`.

## Diagnóstico

```bash
journalctl -u noc-agent -n 200 --no-pager
systemctl show noc-agent -p Restart -p ReadWritePaths -p NoNewPrivileges
df -h /opt/noc-agent
free -h
```

Erros HTTP 429 de IA indicam quota do provedor, não falha do servidor. Configure fallback. Avisos de WhatsApp indicam que `admin_whatsapp` ou Evolution não estão configurados.

## Atualização

1. Criar backup no painel.
2. Sincronizar o código.
3. Executar `npm install` e `npm --prefix frontend install` se dependências mudaram.
4. Executar `npx prisma validate`, `npx prisma db push` e `npx prisma generate`.
5. Executar `npm test` e `npm --prefix frontend run build`.
6. Reiniciar `systemctl restart noc-agent`.
7. Validar health, logs, login, chat e webhook.

## Segurança

- Nunca versionar `.env`, banco ou backups.
- Expor o painel somente pela LAN/VPN enquanto usar HTTP.
- Para acesso externo, configurar domínio, TLS válido e redirecionamento HTTP → HTTPS.
- Manter `ENCRYPTION_KEY` fora do banco; sem ela as credenciais criptografadas não podem ser recuperadas.
- Ativar 2FA para administradores.

## Recuperação de emergência

Se o painel não iniciar, preserve primeiro `prisma/data` e `backups`. Consulte o journal, valide `.env`, rode `npx prisma validate` e restaure somente um arquivo com integridade confirmada. Não apague o banco atual antes de criar uma cópia recuperável.

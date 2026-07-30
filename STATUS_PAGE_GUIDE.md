# Status Page

A Status Page publica disponibilidade e atualizações editoriais sem revelar IPs, nomes internos, credenciais, comandos ou mensagens brutas do monitoramento.

## Administração

Abra **Status Page** no menu administrativo:

1. defina o título e a descrição pública;
2. crie um serviço e, opcionalmente, vincule-o a um equipamento;
3. mantenha o estado automático para refletir Tasks abertas do equipamento;
4. publique incidentes ou manutenções com texto apropriado ao público;
5. durante o atendimento, publique atualizações como **Causa identificada**, **Monitorando** e **Resolvido**.

Uma Task de prioridade média/baixa degrada o serviço; alta gera indisponibilidade parcial; crítica gera indisponibilidade. Tasks encerradas deixam de afetar o estado. Uma manutenção dentro da janela configurada exibe **Em manutenção**.

## Página pública

A URL pública é:

`https://ENDERECO_DO_NOC/status`

Ela funciona sem autenticação e atualiza a cada minuto. Somente dados editoriais da Status Page são enviados. Equipamentos vinculados e detalhes das Tasks nunca aparecem na resposta pública.

## Comunicação

Publicações e atualizações são registradas na Central de Notificações. Quando notificações externas estão habilitadas, usam Telegram e WhatsApp conforme os canais globais de alta/crítica.

## Disponibilidade

Cada alteração de estado cria um evento de histórico. A página calcula a disponibilidade dos últimos 30 dias descontando períodos de indisponibilidade parcial e total. Manutenções e degradações são mostradas, mas não entram como indisponibilidade nesse indicador.

# Central de notificações

O NOC Agent mantém uma central interna para eventos de incidentes, Runbooks e exceções de compliance. A central continua registrando eventos mesmo quando os canais externos estiverem desabilitados.

## Uso

1. Abra **Notificações** no menu lateral.
2. Clique em uma notificação para marcá-la como lida ou use **Marcar todas**.
3. Administradores podem criar regras em **Nova regra**.

As regras podem filtrar prioridade, evento, origem, grupo de equipamentos, dias e janela de horário. Campos de filtro vazios aceitam qualquer valor. Quando mais de uma regra corresponde, os canais e destinatários são combinados.

## Canais

- **Painel:** registro interno para todos os usuários autenticados.
- **Telegram:** usa o token configurado e os Chat IDs da regra; sem destinatários na regra, usa os Chat IDs globais.
- **WhatsApp:** envia ao número administrativo configurado na Evolution API.

Se nenhuma regra corresponder ao evento, o sistema mantém o comportamento global definido em Configurações. As chaves e tokens permanecem criptografados.

## Exemplo

Uma regra `Críticos fora do expediente` pode selecionar prioridade `critical`, canal `panel, telegram, whatsapp`, período `18:00–08:00` e o fuso `America/Porto_Velho`. Janelas que atravessam a meia-noite são aceitas.

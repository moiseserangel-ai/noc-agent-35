# Operação do Inspetor de Tráfego NetFlow/IPFIX

## Objetivo e arquitetura

O módulo recebe NetFlow/IPFIX no Akvorado/ClickHouse, consolida amostras a cada cinco minutos e apresenta os resultados no NOC Agent. A detecção é assistida: observar tráfego ou classificar uma anomalia não altera o equipamento. Uma mitigação somente é executada após classificação como ataque, revisão e aprovação explícita de um administrador.

Fluxo operacional: equipamento → coletor Akvorado → ClickHouse → NOC Agent → painel/Task/Telegram. A ausência de payload no NetFlow significa que domínio e aplicação podem ser apenas estimados por DNS e portas.

## Configuração do MikroTik

Substitua `IP_DO_COLETOR` pelo endereço do CT do Akvorado. Confirme a porta configurada no coletor; o exemplo usa UDP 2055. Restrinja o tráfego no firewall para permitir somente equipamento e coletor.

### RouterOS 7

```routeros
/ip traffic-flow set enabled=yes interfaces=all cache-entries=64k active-flow-timeout=5m inactive-flow-timeout=15s
/ip traffic-flow target add dst-address=IP_DO_COLETOR port=2055 version=ipfix v9-template-refresh=20 v9-template-timeout=1m comment="NOC Agent: exportacao NetFlow/IPFIX para o coletor"
```

Se a versão instalada não oferecer `ipfix`, utilize `version=9`. Em equipamentos de alto tráfego, selecione interfaces específicas em vez de `interfaces=all` e acompanhe CPU.

### RouterOS 6

```routeros
/ip traffic-flow set enabled=yes interfaces=all cache-entries=64k active-flow-timeout=5m inactive-flow-timeout=15s
/ip traffic-flow target add dst-address=IP_DO_COLETOR port=2055 version=9 v9-template-refresh=20 v9-template-timeout=1m comment="NOC Agent: exportacao NetFlow v9 para o coletor"
```

O intervalo `v9-template-timeout=1m` deve ser mantido em todos os exportadores. Após uma reinicialização, o NetFlow v9 perde o estado de sessão e o coletor precisa receber novamente o template para interpretar os registros. Intervalos longos, como 30 minutos, podem fazer o painel indicar ausência de coleta mesmo com UDP chegando ao coletor.

Quando o caminho até o coletor utiliza uma interface dinâmica, como L2TP, prefira `src-address=0.0.0.0` no alvo NetFlow. O RouterOS selecionará o endereço pela rota ativa e poderá recriar o socket após a reconexão do túnel. Fixar como origem um endereço dinâmico pode interromper a exportação quando a interface L2TP é recriada, mesmo que ela receba novamente o mesmo IP.

### Validação no MikroTik

```routeros
/ip traffic-flow print detail
/ip traffic-flow target print detail
/tool sniffer quick ip-address=IP_DO_COLETOR port=2055
```

No NOC Agent, abra **Inspeção de tráfego**, use **Coletar agora** e confirme que o equipamento aparece em **Saúde dos exportadores** como Online. O nome do exportador deve corresponder ao equipamento cadastrado para associar incidentes e Tasks corretamente.

## Linha de base e detecção

A linha de base exige 288 amostras, aproximadamente 24 horas com coleta a cada cinco minutos. Antes disso, o painel mostra aprendizado. Depois, desvios são comparados com o percentil 95 recente. Detectores nativos incluem varredura de portas, flood TCP/UDP/ICMP, amplificação UDP, volume anormal e exportador sem comunicação.

Use o perfil por equipamento para ajustar limites e IPs confiáveis. Valores muito baixos geram falsos positivos; altere gradualmente e valide o histórico.

## Correlação local e pontuação de risco

O painel correlaciona anomalias ativas em uma janela móvel de 15 minutos, sem consultar APIs externas. São reconhecidos três padrões: a mesma origem em vários equipamentos, várias origens contra o mesmo destino e serviço, e uma possível sequência de ataque em portas diferentes. O agrupamento mostra eventos, equipamentos, origens e risco consolidado.

Cada anomalia recebe risco de 0 a 100 calculado por severidade, confiança, recorrência, volume, quantidade de eventos relacionados, dispersão entre exportadores e criticidade do destino no inventário. A pontuação auxilia a priorização, mas não confirma ataque nem autoriza mitigação por conta própria.

Quando uma nova anomalia confirmada estiver relacionada a outra Task NetFlow aberta nos últimos 15 minutos, o sistema adiciona a evidência à Task existente em vez de criar outra. A linha do tempo registra o motivo da correlação e continua informando que nenhuma mitigação foi executada.

## Reputação de endereços públicos

Configure a **API Key do AbuseIPDB** em **Configurações → Inteligência de ameaças**. A chave é armazenada criptografada. O limite local padrão é 25 consultas por dia e pode ser ajustado pelo administrador; cada resultado válido permanece em cache por 24 horas.

O sistema consulta automaticamente a origem pública quando confirma uma nova anomalia. Também é possível usar **Consultar reputação** no cartão do evento. A consulta considera os últimos 90 dias e exibe confiança de abuso, denúncias, país e provedor. A reputação pode acrescentar até 20 pontos ao risco, mas nunca classifica o evento como ataque nem executa bloqueio sozinha.

Sem chave, com limite atingido ou durante falha do provedor, a detecção local continua funcionando. Códigos 429 são tratados como esgotamento de cota e resultados vencidos não são apresentados como atuais.

## Regras personalizadas

Uma regra pode filtrar equipamento, protocolo, porta, IP de origem/destino, país e volume mínimo. Antes de salvar, use **Testar sem notificar**: a simulação consulta cinco minutos, não salva, não cria Task e não envia mensagem.

Modos disponíveis:

- Somente painel: registra a anomalia sem ação externa.
- Criar Task: abre incidente, sem Telegram.
- Telegram: envia mensagem sem Task.
- Task + Telegram: abre incidente e envia mensagem.

Configure prioridade, número de coletas para confirmação e intervalo de recorrência. Um Chat ID vazio usa os destinatários globais.

## Silenciamento e recorrência

Use **Silenciamento programado** para manutenção. Escolha equipamento/regra, início, fim e motivo. Durante a janela, a ocorrência fica registrada como suprimida, mas não cria Task, notificação ou mitigação.

O controle de recorrência evita ações repetidas para o mesmo evento depois de uma ocorrência recente. O padrão global é 60 minutos e pode ser substituído por regra. A recorrência é registrada na anomalia e, quando houver, na linha do tempo da Task anterior.

## Notificações

O histórico informa canal, destinatário, data, status e falha resumida. Somente administradores podem reenviar Telegram/WhatsApp; o reenvio exige confirmação e gera novo registro auditável. Para falhas, valide token, Chat ID, conectividade DNS/HTTPS e a configuração global de notificações.

## Saúde dos exportadores

Estados: Online (há fluxo recente), Atrasado (dentro da tolerância) e Sem comunicação (tolerância excedida). O padrão é 15 minutos e criação de Task; ambientes com templates renovados a cada minuto podem reduzir a tolerância para 5 minutos. O monitor respeita silenciamentos, não duplica incidentes e resolve automaticamente a Task quando a exportação retorna.

Após reiniciar um equipamento, valide que ele reaparece no painel em aproximadamente um minuto. Se não retornar em até cinco minutos, confirme o alvo UDP 2055, a rota até o coletor e a renovação do template antes de reiniciar serviços.

Antes de concluir que o roteador caiu, valide rota e firewall UDP, alvo do traffic-flow, relógio/NTP, nome do exportador, CPU e serviço do coletor.

O watchdog pode executar uma única reinicialização do serviço Traffic Flow após a confirmação da indisponibilidade. Há cooldown padrão de 60 minutos por exportador. A ação não reinicia roteador, interface, túnel ou container; seu resultado é registrado na Task e na auditoria. Se os fluxos não retornarem, a investigação permanece manual.

O painel também apresenta fluxos por minuto, atraso, equipamento relacionado, causa provável e a última tentativa do watchdog. A seção **Saúde do coletor** acompanha ClickHouse, atraso de processamento, uso de disco, tamanho da base, memória do processo e uptime. Estados críticos confirmados em duas verificações criam uma única Task e são resolvidos automaticamente após a normalização.

## Classificação e mitigação assistida

Classifique como ataque, falso positivo ou tráfego legítimo e informe justificativa. Falso positivo e legítimo suprimem eventos equivalentes por 30 dias.

A mitigação aceita somente anomalia confirmada como ataque e IP público externo. O sistema recusa endereços privados, reservados, faixas de documentação e benchmark, DNS públicos protegidos, IPs confiáveis e ativos existentes no CMDB/IPAM. Antes da mudança, cria backup do MikroTik, repete as validações de segurança e confirma que o limite de 20 bloqueios ativos não foi atingido.

Cada MikroTik protegido deve possuir exatamente duas regras controladas e ativas: uma em `input` e outra em `forward`, ambas com `action=drop`, `src-address-list=NOC-ASSISTED-BLOCK` e `in-interface-list=OPERADORAS`. A regra de `forward` deve ficar antes do FastTrack, e a de `input` antes das permissões de entrada. Os comentários esperados são `NOC Agent: mitigacao assistida - input` e `NOC Agent: mitigacao assistida - forward`.

Após a aprovação explícita do administrador, o sistema adiciona o IP com expiração e comentário auditável, confirma sua presença no equipamento e executa rollback automático se a validação falhar. A expiração ou o rollback remove somente a entrada criada pelo NOC Agent. O teste de implantação usa um endereço reservado de documentação por poucos segundos e o remove imediatamente; nunca use endereço real para esse teste. Nunca aprove uma mitigação sem revisar origem, destino, impacto e comando.

### Mitigação supervisionada em lote

Para uma campanha confirmada, selecione entre 2 e 10 eventos classificados como ataque e use **Preparar lote**. O sistema valida todos os endereços, relaciona os exportadores aos MikroTik, verifica duplicidade e capacidade, mas ainda não altera os equipamentos. A duração padrão recomendada é 30 minutos.

O administrador deve revisar e selecionar as propostas antes de **Aplicar lote selecionado**. A execução confirma as regras controladas, verifica novamente os limites e cria um backup por equipamento. Cada entrada é aplicada e validada individualmente. Se qualquer aplicação ou validação falhar, todas as entradas já aplicadas pelo lote são removidas em ordem reversa e o lote inteiro fica marcado como falha.

O limite operacional é de 10 itens por lote e 20 bloqueios ativos por equipamento. O mesmo IP pode fazer parte do lote em equipamentos diferentes, mas não pode ser duplicado no mesmo equipamento. Não há bloqueio por prefixo, país ou ASN. A aprovação continua exclusiva do administrador, e a Task recebe o resultado consolidado da operação.

## Retenção

Padrões: métricas 30 dias; anomalias, notificações e silenciamentos 180 dias; fluxos brutos 15 dias. A limpeza automática roda no máximo uma vez ao dia. A prévia mostra quantidades elegíveis. A limpeza manual exige confirmação e preserva anomalias ativas.

Antes de reduzir prazos, confirme requisitos contratuais, forenses e de compliance. Exporte relatórios necessários e mantenha backup do banco.

## Diagnóstico rápido

1. Confirme que o exportador aparece e atualiza a última coleta.
2. Valide UDP entre roteador e coletor.
3. Verifique o alvo e a versão NetFlow/IPFIX no RouterOS.
4. Teste a integração do inspetor e a consulta dos últimos cinco minutos.
5. Verifique silenciamentos, IPs confiáveis, recorrência e limites do perfil.
6. Consulte o histórico de notificações e os logs do NOC Agent/Akvorado.
7. Não desligue detectores nem reduza limites de forma ampla durante uma investigação.

## Checklist de mudança

- Backup atual do equipamento disponível.
- Coletor, IP, porta e protocolo documentados.
- Firewall permite apenas origem/destino necessários.
- CPU e volume do roteador observados após ativação.
- Exportador Online no painel.
- Regra testada antes de ativar.
- Canal de notificação validado.
- Janela de manutenção cadastrada quando aplicável.
- Evidências e justificativa registradas na Task.
- Recuperação e rollback validados.

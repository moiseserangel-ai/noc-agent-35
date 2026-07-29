# Plugins de especialistas por fabricante

O núcleo resolve especialistas pelo `Device.type`. Cada plugin publicado em
`src/vendors/registry.js` declara tipo, nome, fabricante, plataforma e classe do
agente. O catálogo público alimenta automaticamente o cadastro e o seletor do chat.

## Fabricantes incluídos

- MikroTik RouterOS (`mikrotik`)
- Huawei VRP / NetEngine (`huawei_vrp`)
- Cisco IOS / IOS-XE (`cisco_ios`)
- Juniper Junos (`juniper_junos`)
- Fortinet FortiGate / FortiOS (`fortigate_fortios`)
- Ubiquiti EdgeRouter / EdgeOS (`ubiquiti_edgeos`)
- Ubiquiti UniFi Controller (`unifi_controller`, API somente leitura)
- Datacom DMOS (`datacom_dmos`)
- Nokia SR OS (`nokia_sros`)
- Linux avançado (`linux`)
- Linux (`linux`, operações de servidor)

O plugin Cisco oferece especialista de IA, SSH controlado, terminal interativo,
backup de `running-config`, compliance básico e descoberta LLDP/CDP. Alterações
exigem aprovação e comandos destrutivos permanecem bloqueados.

O plugin Juniper oferece especialista para MX, SRX, EX, QFX, ACX e PTX, SSH
controlado, terminal, backup em formato `display set`, compliance e descoberta
LLDP. Mudanças orientam `configure exclusive`, `commit check` e
`commit confirmed`, com registro `annotate` quando compatível.

O plugin FortiGate oferece especialista FortiOS, terminal e SSH controlados,
backup de configuração completa, compliance de acesso administrativo, logs,
SNMP, HA e política de senhas, além de descoberta LLDP. Mudanças em políticas
recebem `set comments` quando ainda não possuem comentário explícito.

O plugin EdgeOS oferece especialista, terminal, backup em comandos, compliance e
LLDP. Alterações seguem configure/compare/commit/save e recebem description nas
interfaces compatíveis.

O plugin UniFi consulta UniFi OS e controladores legados por HTTPS. A primeira
versão expõe somente status, sites, dispositivos, clientes e alarmes. Rotas
arbitrárias e operações de escrita são bloqueadas.

## Histórico das implementações multi-vendor

- Cisco IOS/IOS-XE: especialista, SSH seguro, terminal, backup, compliance e LLDP/CDP.
- Juniper Junos: backup `display set`, LLDP, compliance, `annotate` e orientação de commit confirmed.
- FortiGate: backup completo, compliance, LLDP e comentários nativos em políticas.
- EdgeOS: backup em comandos, compliance, LLDP e descriptions em interfaces.
- UniFi Controller: status, sites, dispositivos, clientes e alarmes por API somente leitura.
- Datacom DMOS: especialista e SSH seguro; backup por `show running-config`.
- Nokia SR OS: especialista e SSH seguro; backup por `show configuration`.
- Linux avançado: snapshot de sistema, rede, rotas e serviços habilitados.

Toda alteração em equipamento exige Task e aprovação. Operações destrutivas
permanecem bloqueadas mesmo após aprovação. Datacom e Nokia devem ser homologados
em laboratório porque a sintaxe pode variar conforme família e versão.

## Datacom DMOS

- Diagnóstico: `show`, `ping` e `traceroute`.
- Backup: `show running-config`.
- Topologia: `show lldp neighbors detail`.
- Compliance: 8 controles de identidade, SSH/Telnet, NTP, syslog, SNMP, ACL de
  gestão e usuários.
- Alterações em interface recebem `description` quando ainda não houver uma
  descrição explícita.

## Nokia SR OS

- Diagnóstico: `show`, `ping`, `traceroute` e equivalentes `tools perform`.
- Backup: `show configuration`.
- Topologia: `show system lldp neighbor`.
- Compliance: 8 controles de identidade, SSH/Telnet, NTP, syslog, SNMP, filtro
  CPM/gestão e usuários/AAA.
- Suporta a base comum de CLI clássica e MD-CLI, mas a versão e o modo devem ser
  confirmados antes de qualquer alteração.

## Linux avançado

- Snapshot: distribuição, endereços, rotas e serviços habilitados.
- Compliance: 6 controles de inventário, SSH, firewall, horário, logs e rota
  padrão.
- Mudanças aprovadas continuam registradas no syslog com a tag `noc-agent`.
- O snapshot não substitui backup de arquivos, banco de dados ou imagem do
  servidor; ele representa apenas o estado operacional gerenciado pelo NOC.

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

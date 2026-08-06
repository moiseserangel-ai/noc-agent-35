import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { captureDeviceConfiguration } from './device-backup.service.js';
import { logAudit } from './audit.service.js';
import { addTaskMessage, createTask, updateTask } from './task.service.js';
import { notifyComplianceException, notifyTask } from './notification.service.js';
import crypto from 'node:crypto';

const running = new Set();
export const COMPLIANCE_PROFILE = 'noc_baseline_v1';
const weights = { critical: 20, high: 12, medium: 7, low: 3 };
const defaultProfileNames = { mikrotik:'MikroTik - Baseline NOC', huawei_vrp:'Huawei VRP - Baseline NOC', cisco_ios:'Cisco IOS-XE - Baseline NOC', juniper_junos:'Juniper Junos - Baseline NOC', fortigate_fortios:'FortiGate FortiOS - Baseline NOC', ubiquiti_edgeos:'Ubiquiti EdgeOS - Baseline NOC', datacom_dmos:'Datacom DMOS - Baseline NOC', nokia_sros:'Nokia SR OS - Baseline NOC', linux:'Linux - Baseline NOC' };

const result = (rule, compliant, evidence) => ({ ...rule, status: compliant ? 'compliant' : 'non_compliant', evidence: String(evidence || '').slice(0, 1200) });
const contains = (text, pattern) => pattern.test(text);

function routerOsCanonical(config) {
  let section = '';
  return String(config).split(/\r?\n/).map(raw => raw.trim()).filter(Boolean).map(line => {
    if (/^\/[A-Za-z]/.test(line)) {
      section = line;
      return line;
    }
    return /^(?:set|add|remove|enable|disable)\b/i.test(line) && section ? `${section} ${line}` : line;
  }).join('\n');
}

export function evaluateMikrotikCompliance(configuration) {
  const text = routerOsCanonical(configuration);
  const serviceDisabled = name => contains(text, new RegExp(`^/ip service set ${name}\\b[^\\n]*\\bdisabled=yes`, 'mi'));
  const rules = [
    result({ ruleKey:'mt_identity', title:'Identidade personalizada', category:'Identidade', severity:'medium', recommendation:'Defina um nome único e padronizado para o roteador.', remediationPreview:'/system identity set name=<NOME-PADRAO>' }, contains(text, /^\/system identity set\b[^\n]*\bname=(?!"?MikroTik"?\b)\S+/mi), (text.match(/^\/system identity set.*$/mi)||['Identidade padrão ou não exportada'])[0]),
    result({ ruleKey:'mt_ntp', title:'Sincronização NTP habilitada', category:'Tempo', severity:'high', recommendation:'Habilite NTP e configure servidores confiáveis para auditoria correta.', remediationPreview:'/system ntp client set enabled=yes\n/system ntp client servers add address=<SERVIDOR-NTP>' }, contains(text, /^\/system ntp client set\b[^\n]*\benabled=yes/mi), (text.match(/^\/system ntp client set.*$/mi)||['NTP não habilitado'])[0]),
    result({ ruleKey:'mt_dns_remote', title:'Recursão DNS remota desabilitada', category:'Serviços', severity:'high', recommendation:'Mantenha allow-remote-requests desabilitado, salvo quando protegido por firewall.', remediationPreview:'/ip dns set allow-remote-requests=no' }, !contains(text, /^\/ip dns set\b[^\n]*\ballow-remote-requests=yes/mi), (text.match(/^\/ip dns set.*$/mi)||['Padrão seguro: recursão remota desabilitada'])[0]),
    result({ ruleKey:'mt_telnet', title:'Serviço Telnet desabilitado', category:'Acesso', severity:'critical', recommendation:'Desabilite Telnet e utilize SSH.', remediationPreview:'/ip service disable telnet' }, serviceDisabled('telnet'), (text.match(/^\/ip service set telnet.*$/mi)||['Telnet não aparece como desabilitado'])[0]),
    result({ ruleKey:'mt_ftp', title:'Serviço FTP desabilitado', category:'Acesso', severity:'high', recommendation:'Desabilite FTP e utilize transferência segura quando necessária.', remediationPreview:'/ip service disable ftp' }, serviceDisabled('ftp'), (text.match(/^\/ip service set ftp.*$/mi)||['FTP não aparece como desabilitado'])[0]),
    result({ ruleKey:'mt_api', title:'API sem TLS desabilitada', category:'Acesso', severity:'high', recommendation:'Desabilite a API simples ou restrinja-a à rede de gestão.', remediationPreview:'/ip service disable api' }, serviceDisabled('api'), (text.match(/^\/ip service set api.*$/mi)||['API não aparece como desabilitada'])[0]),
    result({ ruleKey:'mt_mac_winbox', title:'MAC Winbox restrito', category:'Camada 2', severity:'high', recommendation:'Restrinja MAC Winbox a uma interface-list de gestão.', remediationPreview:'/tool mac-server mac-winbox set allowed-interface-list=<REDE-PERMITIDA>' }, contains(text, /^\/tool mac-server mac-winbox set\b[^\n]*allowed-interface-list=(?!"?all"?\b)\S+/mi), (text.match(/^\/tool mac-server mac-winbox set.*$/mi)||['MAC Winbox sem restrição explícita'])[0]),
    result({ ruleKey:'mt_firewall_input', title:'Política de firewall de entrada presente', category:'Firewall', severity:'critical', recommendation:'Implemente regras de input com liberação explícita da gestão e bloqueio final.', remediationPreview:'Revisar /ip firewall filter e aplicar baseline aprovado.' }, contains(text, /^\/ip firewall filter add\b[^\n]*\bchain=input/mi), `${(text.match(/^\/ip firewall filter add\b[^\n]*\bchain=input/gmi)||[]).length} regra(s) de input encontrada(s)`),
    result({ ruleKey:'mt_ssh', title:'SSH com parâmetros seguros', category:'Acesso', severity:'high', recommendation:'Mantenha SSH habilitado, restrito à gestão e com criptografia forte.', remediationPreview:'/ip ssh set strong-crypto=yes' }, contains(text, /^\/ip ssh set\b[^\n]*\bstrong-crypto=yes/mi), (text.match(/^\/ip ssh set.*$/mi)||['Criptografia forte de SSH não confirmada'])[0]),
    result({ ruleKey:'mt_snmp', title:'SNMP configurado para monitoramento', category:'Monitoramento', severity:'medium', recommendation:'Configure SNMPv3 ou restrinja comunidades à rede do Zabbix.', remediationPreview:'Revisar comunidades SNMP e origem permitida antes da aplicação.' }, contains(text, /^\/snmp set\b[^\n]*\benabled=yes/mi), (text.match(/^\/snmp set.*$/mi)||['SNMP não habilitado'])[0]),
    result({ ruleKey:'mt_logging', title:'Log remoto configurado', category:'Logs', severity:'medium', recommendation:'Envie eventos relevantes a um servidor central de logs.', remediationPreview:'/system logging action add name=remote-noc target=remote remote=<SERVIDOR-SYSLOG>' }, contains(text, /^\/system logging action add\b[^\n]*\btarget=remote/mi), (text.match(/^\/system logging action add\b[^\n]*\btarget=remote.*$/mi)||['Ação de log remoto não localizada'])[0]),
    result({ ruleKey:'mt_user_admin', title:'Conta administrativa padrão revisada', category:'Identidade', severity:'high', recommendation:'Desabilite ou renomeie a conta admin padrão quando houver outra conta segura.', remediationPreview:'Revisar usuários ativos e política de recuperação antes de alterar contas.' }, !contains(text, /^\/user add\b[^\n]*\bname="?admin"?\b/mi), 'Verificação da presença explícita da conta admin no export'),
  ];
  return rules;
}

export function evaluateHuaweiCompliance(configuration) {
  const text = String(configuration);
  return [
    result({ ruleKey:'hw_sysname', title:'Sysname configurado', category:'Identidade', severity:'medium', recommendation:'Configure um sysname único conforme o inventário.', remediationPreview:'system-view\nsysname <NOME-PADRAO>' }, contains(text, /^\s*sysname\s+\S+/mi), (text.match(/^\s*sysname\s+.*$/mi)||['Sysname não localizado'])[0]),
    result({ ruleKey:'hw_ntp', title:'NTP configurado', category:'Tempo', severity:'high', recommendation:'Configure servidores NTP confiáveis.', remediationPreview:'system-view\nntp-service unicast-server <SERVIDOR-NTP>' }, contains(text, /^\s*ntp-service\s+/mi), (text.match(/^\s*ntp-service\s+.*$/mi)||['NTP não localizado'])[0]),
    result({ ruleKey:'hw_stelnet', title:'STelnet habilitado', category:'Acesso', severity:'high', recommendation:'Habilite STelnet para administração SSH segura.', remediationPreview:'system-view\nstelnet server enable' }, contains(text, /^\s*stelnet server enable/mi), (text.match(/^\s*stelnet server.*$/mi)||['STelnet não localizado'])[0]),
    result({ ruleKey:'hw_telnet', title:'Telnet desabilitado', category:'Acesso', severity:'critical', recommendation:'Desabilite o servidor Telnet.', remediationPreview:'system-view\nundo telnet server enable' }, !contains(text, /^\s*telnet server enable/mi), (text.match(/^\s*telnet server.*$/mi)||['Telnet não habilitado'])[0]),
    result({ ruleKey:'hw_ssh_source', title:'Origem do servidor SSH restringida', category:'Acesso', severity:'high', recommendation:'Defina a interface ou endereço de origem do servidor SSH.', remediationPreview:'system-view\nssh server-source -i <INTERFACE-GESTAO>' }, contains(text, /^\s*ssh server-source\s+/mi), (text.match(/^\s*ssh server-source.*$/mi)||['Origem SSH não restringida'])[0]),
    result({ ruleKey:'hw_snmp', title:'Monitoramento SNMP configurado', category:'Monitoramento', severity:'medium', recommendation:'Configure SNMPv3 ou parâmetros seguros para integração com o Zabbix.', remediationPreview:'Revisar política SNMPv3 antes da aplicação.' }, contains(text, /^\s*snmp-agent\b/mi), (text.match(/^\s*snmp-agent.*$/mi)||['SNMP não localizado'])[0]),
    result({ ruleKey:'hw_info_center', title:'Info-center configurado', category:'Logs', severity:'medium', recommendation:'Configure envio e retenção de logs conforme a política do NOC.', remediationPreview:'Revisar destinos e severidades do info-center.' }, contains(text, /^\s*info-center\s+/mi), (text.match(/^\s*info-center.*$/mi)||['Info-center não localizado'])[0]),
    result({ ruleKey:'hw_aaa', title:'AAA configurado', category:'Identidade', severity:'high', recommendation:'Utilize AAA com contas individualizadas e privilégios mínimos.', remediationPreview:'Revisar domínio AAA, métodos de autenticação e contingência antes da aplicação.' }, contains(text, /^\s*aaa\s*$/mi), (text.match(/^\s*aaa\s*$/mi)||['Seção AAA não localizada'])[0]),
    result({ ruleKey:'hw_acl_vty', title:'VTY protegido por ACL', category:'Acesso', severity:'critical', recommendation:'Restrinja acesso às linhas VTY por ACL de gestão.', remediationPreview:'user-interface vty 0 4\nacl <ACL-GESTAO> inbound' }, contains(text, /^\s*acl\s+\S+\s+inbound/mi), (text.match(/^\s*acl\s+\S+\s+inbound.*$/mi)||['ACL inbound nas VTY não localizada'])[0]),
    result({ ruleKey:'hw_password_policy', title:'Política de senha configurada', category:'Identidade', severity:'high', recommendation:'Defina complexidade, expiração e histórico de senhas conforme a política.', remediationPreview:'Revisar política local de senhas e integração AAA antes da aplicação.' }, contains(text, /^\s*password policy administrator/mi), (text.match(/^\s*password policy administrator.*$/mi)||['Política administrativa de senha não localizada'])[0]),
    result({ ruleKey:'hw_loopback', title:'Interface de gestão estável', category:'Gestão', severity:'medium', recommendation:'Utilize LoopBack ou interface dedicada como origem dos serviços de gestão.', remediationPreview:'Revisar endereçamento de gestão antes de criar ou alterar LoopBack.' }, contains(text, /^\s*interface LoopBack/mi), (text.match(/^\s*interface LoopBack.*$/mi)||['LoopBack não localizada'])[0]),
  ];
}

export function evaluateCiscoCompliance(configuration){
  const text=String(configuration);
  return[
    result({ruleKey:'cs_hostname',title:'Hostname configurado',category:'Identidade',severity:'medium',recommendation:'Configure hostname único conforme o inventário.',remediationPreview:'configure terminal\nhostname <NOME-PADRAO>\nend'},contains(text,/^\s*hostname\s+(?!Router\b)\S+/mi),(text.match(/^\s*hostname\s+.*$/mi)||['Hostname padrão ou ausente'])[0]),
    result({ruleKey:'cs_ssh_v2',title:'SSH versão 2 habilitado',category:'Acesso',severity:'critical',recommendation:'Utilize SSHv2 para administração segura.',remediationPreview:'configure terminal\nip ssh version 2\nend'},contains(text,/^\s*ip ssh version 2/mi),(text.match(/^\s*ip ssh version.*$/mi)||['SSHv2 não confirmado'])[0]),
    result({ruleKey:'cs_no_http',title:'Servidor HTTP desabilitado',category:'Serviços',severity:'high',recommendation:'Desabilite HTTP sem TLS quando não for necessário.',remediationPreview:'configure terminal\nno ip http server\nend'},contains(text,/^\s*no ip http server/mi),(text.match(/^\s*(?:no )?ip http server.*$/mi)||['Estado do HTTP não confirmado'])[0]),
    result({ruleKey:'cs_ntp',title:'NTP configurado',category:'Tempo',severity:'high',recommendation:'Configure servidores NTP confiáveis.',remediationPreview:'configure terminal\nntp server <SERVIDOR-NTP>\nend'},contains(text,/^\s*ntp server\s+\S+/mi),(text.match(/^\s*ntp server.*$/mi)||['Servidor NTP não localizado'])[0]),
    result({ruleKey:'cs_logging',title:'Syslog remoto configurado',category:'Logs',severity:'medium',recommendation:'Envie logs a um coletor central.',remediationPreview:'configure terminal\nlogging host <SERVIDOR-SYSLOG>\nend'},contains(text,/^\s*logging (?:host\s+)?\d{1,3}(?:\.\d{1,3}){3}/mi),(text.match(/^\s*logging (?:host\s+)?.*$/mi)||['Syslog remoto não localizado'])[0]),
    result({ruleKey:'cs_vty_acl',title:'VTY protegida por ACL',category:'Acesso',severity:'critical',recommendation:'Restrinja as linhas VTY à rede de gestão.',remediationPreview:'configure terminal\nline vty 0 15\naccess-class <ACL-GESTAO> in\nend'},contains(text,/^\s*access-class\s+\S+\s+in/mi),(text.match(/^\s*access-class.*$/mi)||['ACL inbound nas VTY não localizada'])[0]),
    result({ruleKey:'cs_transport_ssh',title:'VTY aceita somente SSH',category:'Acesso',severity:'critical',recommendation:'Remova Telnet das linhas VTY.',remediationPreview:'configure terminal\nline vty 0 15\ntransport input ssh\nend'},contains(text,/^\s*transport input ssh\s*$/mi),(text.match(/^\s*transport input.*$/mi)||['Transporte SSH exclusivo não confirmado'])[0]),
    result({ruleKey:'cs_aaa',title:'AAA habilitado',category:'Identidade',severity:'high',recommendation:'Habilite AAA com método de contingência aprovado.',remediationPreview:'Revisar servidores TACACS/RADIUS e acesso local antes da aplicação.'},contains(text,/^\s*aaa new-model/mi),(text.match(/^\s*aaa new-model.*$/mi)||['AAA new-model não localizado'])[0]),
    result({ruleKey:'cs_snmp_secure',title:'SNMP comunitário público ausente',category:'Monitoramento',severity:'high',recommendation:'Prefira SNMPv3 e remova comunidades padrão public/private.',remediationPreview:'Revisar integração Zabbix e migrar para SNMPv3 antes da remoção.'},!contains(text,/^\s*snmp-server community\s+(?:public|private)\b/mi),(text.match(/^\s*snmp-server community\s+(?:public|private).*$/mi)||['Comunidades padrão não localizadas'])[0]),
  ];
}

export function evaluateJuniperCompliance(configuration) {
  const text = String(configuration);
  return [
    result({ruleKey:'jn_host_name',title:'Host-name configurado',category:'Identidade',severity:'medium',recommendation:'Configure host-name único conforme o inventário.',remediationPreview:'set system host-name <NOME-PADRAO>'},contains(text,/^set system host-name\s+\S+/mi),(text.match(/^set system host-name.*$/mi)||['Host-name não localizado'])[0]),
    result({ruleKey:'jn_ssh',title:'SSH habilitado',category:'Acesso',severity:'critical',recommendation:'Habilite SSH para administração segura.',remediationPreview:'set system services ssh'},contains(text,/^set system services ssh\b/mi),(text.match(/^set system services ssh.*$/mi)||['SSH não localizado'])[0]),
    result({ruleKey:'jn_no_telnet',title:'Telnet desabilitado',category:'Acesso',severity:'critical',recommendation:'Remova o serviço Telnet.',remediationPreview:'delete system services telnet'},!contains(text,/^set system services telnet\b/mi),(text.match(/^set system services telnet.*$/mi)||['Telnet não configurado'])[0]),
    result({ruleKey:'jn_ntp',title:'NTP configurado',category:'Tempo',severity:'high',recommendation:'Configure servidores NTP confiáveis.',remediationPreview:'set system ntp server <SERVIDOR-NTP>'},contains(text,/^set system ntp server\s+\S+/mi),(text.match(/^set system ntp server.*$/mi)||['NTP não localizado'])[0]),
    result({ruleKey:'jn_syslog',title:'Syslog remoto configurado',category:'Logs',severity:'medium',recommendation:'Envie eventos a um coletor central.',remediationPreview:'set system syslog host <SERVIDOR-SYSLOG> any notice'},contains(text,/^set system syslog host\s+\S+/mi),(text.match(/^set system syslog host.*$/mi)||['Syslog remoto não localizado'])[0]),
    result({ruleKey:'jn_root_auth',title:'Autenticação root configurada',category:'Identidade',severity:'high',recommendation:'Configure chave SSH ou hash seguro para recuperação administrativa.',remediationPreview:'Revisar procedimento de recuperação antes de alterar root-authentication.'},contains(text,/^set system root-authentication (?:ssh-|encrypted-password)/mi),(text.match(/^set system root-authentication.*$/mi)||['Root authentication não confirmada'])[0]),
    result({ruleKey:'jn_login_class',title:'Classes de login configuradas',category:'Identidade',severity:'high',recommendation:'Use classes com privilégios mínimos para contas administrativas.',remediationPreview:'Revisar classes e usuários antes da aplicação.'},contains(text,/^set system login class\s+\S+/mi),(text.match(/^set system login class.*$/mi)||['Classes personalizadas não localizadas'])[0]),
    result({ruleKey:'jn_snmp_secure',title:'Comunidades SNMP padrão ausentes',category:'Monitoramento',severity:'high',recommendation:'Prefira SNMPv3 e remova public/private.',remediationPreview:'Revisar integração Zabbix e migrar para SNMPv3.'},!contains(text,/^set snmp community (?:public|private)\b/mi),(text.match(/^set snmp community (?:public|private).*$/mi)||['Comunidades padrão não localizadas'])[0]),
    result({ruleKey:'jn_mgmt_filter',title:'Filtro de proteção aplicado à gestão',category:'Firewall',severity:'critical',recommendation:'Proteja acesso ao Routing Engine com firewall filter.',remediationPreview:'set interfaces lo0 unit 0 family inet filter input <FILTRO-GESTAO>'},contains(text,/^set interfaces lo0 unit \S+ family inet filter input\s+\S+/mi),(text.match(/^set interfaces lo0.*filter input.*$/mi)||['Filtro de gestão em lo0 não localizado'])[0]),
  ];
}

export function evaluateFortiGateCompliance(configuration) {
  const text=String(configuration);
  return[
    result({ruleKey:'fg_hostname',title:'Hostname configurado',category:'Identidade',severity:'medium',recommendation:'Configure hostname único conforme o inventário.',remediationPreview:'config system global\nset hostname <NOME-PADRAO>\nend'},contains(text,/^\s*set hostname\s+(?!"?FortiGate"?\s*$)\S+/mi),(text.match(/^\s*set hostname.*$/mi)||['Hostname padrão ou ausente'])[0]),
    result({ruleKey:'fg_admin_https_ssh',title:'Gestão segura por HTTPS/SSH',category:'Acesso',severity:'critical',recommendation:'Permita apenas protocolos administrativos seguros nas interfaces de gestão.',remediationPreview:'Revisar allowaccess por interface antes da aplicação.'},contains(text,/^\s*set allowaccess\b[^\n]*(?:https|ssh)/mi)&&!contains(text,/^\s*set allowaccess\b[^\n]*\bhttp\b/mi),(text.match(/^\s*set allowaccess.*$/mi)||['allowaccess seguro não confirmado'])[0]),
    result({ruleKey:'fg_admin_trusted',title:'Administradores com trusted hosts',category:'Acesso',severity:'critical',recommendation:'Restrinja contas administrativas a redes confiáveis.',remediationPreview:'config system admin\nedit <ADMIN>\nset trusthost1 <REDE> <MASCARA>\nnext\nend'},contains(text,/^\s*set trusthost1\s+(?!0\.0\.0\.0\s+0\.0\.0\.0)/mi),(text.match(/^\s*set trusthost1.*$/mi)||['Trusted hosts não localizados'])[0]),
    result({ruleKey:'fg_ntp',title:'NTP habilitado',category:'Tempo',severity:'high',recommendation:'Habilite NTP com servidores confiáveis.',remediationPreview:'config system ntp\nset ntpsync enable\nend'},contains(text,/^\s*set ntpsync enable/mi),(text.match(/^\s*set ntpsync.*$/mi)||['NTP não confirmado'])[0]),
    result({ruleKey:'fg_syslog',title:'Log remoto configurado',category:'Logs',severity:'high',recommendation:'Envie logs a FortiAnalyzer ou syslog central.',remediationPreview:'Revisar destino, origem e TLS antes da configuração.'},contains(text,/^\s*set status enable/mi)&&contains(text,/config log (?:syslogd|fortianalyzer)/mi),'Verificação de destino remoto de logs'),
    result({ruleKey:'fg_snmp_secure',title:'SNMP seguro',category:'Monitoramento',severity:'high',recommendation:'Prefira SNMPv3 e restrinja origens.',remediationPreview:'Revisar integração Zabbix e criar usuário SNMPv3.'},contains(text,/config system snmp user/mi)||!contains(text,/^\s*set name "(?:public|private)"/mi),'Verificação SNMPv3/comunidades padrão'),
    result({ruleKey:'fg_ha',title:'Alta disponibilidade revisada',category:'Disponibilidade',severity:'medium',recommendation:'Para firewalls críticos, configure e monitore HA.',remediationPreview:'Planejar HA conforme modelo, licenças e topologia.'},contains(text,/config system ha[\s\S]*?\bset mode (?:a-p|a-a)/mi),'Configuração de HA'),
    result({ruleKey:'fg_password_policy',title:'Política de senha administrativa',category:'Identidade',severity:'high',recommendation:'Habilite política de senha forte para administradores.',remediationPreview:'config system password-policy\nset status enable\nend'},contains(text,/config system password-policy[\s\S]*?\bset status enable/mi),'Política de senha'),
    result({ruleKey:'fg_idle_timeout',title:'Timeout administrativo configurado',category:'Acesso',severity:'medium',recommendation:'Defina timeout administrativo compatível com a política do NOC.',remediationPreview:'config system global\nset admintimeout 10\nend'},contains(text,/^\s*set admintimeout\s+(?:[1-9]|[1-9]\d)\b/mi),(text.match(/^\s*set admintimeout.*$/mi)||['Timeout administrativo não localizado'])[0]),
  ];
}

export function evaluateEdgeOsCompliance(configuration){
  const text=String(configuration);
  return[
    result({ruleKey:'eo_host_name',title:'Host-name configurado',category:'Identidade',severity:'medium',recommendation:'Defina nome único conforme inventário.',remediationPreview:'set system host-name <NOME>'},contains(text,/^set system host-name\s+\S+/mi),(text.match(/^set system host-name.*$/mi)||['Host-name ausente'])[0]),
    result({ruleKey:'eo_ssh',title:'SSH habilitado',category:'Acesso',severity:'critical',recommendation:'Utilize SSH para gestão segura.',remediationPreview:'set service ssh port 22'},contains(text,/^set service ssh\b/mi),(text.match(/^set service ssh.*$/mi)||['SSH ausente'])[0]),
    result({ruleKey:'eo_no_telnet',title:'Telnet desabilitado',category:'Acesso',severity:'critical',recommendation:'Remova Telnet.',remediationPreview:'delete service telnet'},!contains(text,/^set service telnet\b/mi),'Verificação de Telnet'),
    result({ruleKey:'eo_ntp',title:'NTP configurado',category:'Tempo',severity:'high',recommendation:'Configure NTP confiável.',remediationPreview:'set system ntp server <SERVIDOR>'},contains(text,/^set system ntp server\s+\S+/mi),(text.match(/^set system ntp server.*$/mi)||['NTP ausente'])[0]),
    result({ruleKey:'eo_syslog',title:'Syslog remoto configurado',category:'Logs',severity:'medium',recommendation:'Envie logs ao coletor central.',remediationPreview:'set system syslog host <SERVIDOR> facility all level notice'},contains(text,/^set system syslog host\s+\S+/mi),(text.match(/^set system syslog host.*$/mi)||['Syslog remoto ausente'])[0]),
    result({ruleKey:'eo_firewall_local',title:'Firewall local aplicado',category:'Firewall',severity:'critical',recommendation:'Proteja o roteador com política local.',remediationPreview:'Revisar firewall local e interface de gestão.'},contains(text,/^set interfaces \S+ \S+ firewall local name\s+\S+/mi),'Filtro local em interface'),
    result({ruleKey:'eo_snmp_secure',title:'SNMP sem comunidade padrão',category:'Monitoramento',severity:'high',recommendation:'Restrinja SNMP e evite public/private.',remediationPreview:'Revisar integração Zabbix e origens permitidas.'},!contains(text,/^set service snmp community (?:public|private)\b/mi),'Comunidades padrão'),
    result({ruleKey:'eo_user',title:'Usuário administrativo individual',category:'Identidade',severity:'high',recommendation:'Use conta individual com chave SSH.',remediationPreview:'set system login user <USUARIO> authentication public-keys ...'},contains(text,/^set system login user\s+\S+/mi),(text.match(/^set system login user.*$/mi)||['Usuário não localizado'])[0]),
  ];
}

export function evaluateDatacomCompliance(configuration){
  const text=String(configuration);
  return[
    result({ruleKey:'dc_hostname',title:'Hostname configurado',category:'Identidade',severity:'medium',recommendation:'Defina hostname único conforme inventário.',remediationPreview:'hostname <NOME-PADRAO>'},contains(text,/^\s*hostname\s+(?!switch\b)\S+/mi),(text.match(/^\s*hostname.*$/mi)||['Hostname ausente ou padrão'])[0]),
    result({ruleKey:'dc_ssh',title:'SSH habilitado',category:'Acesso',severity:'critical',recommendation:'Utilize SSH para administração segura.',remediationPreview:'Revisar sintaxe SSH conforme versão DMOS.'},contains(text,/^\s*(?:ip )?ssh (?:server )?(?:enable|version 2)/mi),(text.match(/^\s*(?:ip )?ssh.*$/mi)||['SSH não confirmado'])[0]),
    result({ruleKey:'dc_no_telnet',title:'Telnet desabilitado',category:'Acesso',severity:'critical',recommendation:'Desabilite Telnet.',remediationPreview:'Revisar serviço Telnet conforme versão DMOS.'},!contains(text,/^\s*(?:ip )?telnet (?:server )?enable/mi),'Estado do Telnet'),
    result({ruleKey:'dc_ntp',title:'NTP configurado',category:'Tempo',severity:'high',recommendation:'Configure NTP confiável.',remediationPreview:'ntp server <SERVIDOR>'},contains(text,/^\s*ntp (?:server|peer)\s+\S+/mi),(text.match(/^\s*ntp .*$/mi)||['NTP ausente'])[0]),
    result({ruleKey:'dc_syslog',title:'Syslog remoto configurado',category:'Logs',severity:'medium',recommendation:'Envie logs ao coletor central.',remediationPreview:'logging host <SERVIDOR>'},contains(text,/^\s*(?:logging|syslog) (?:host|server)\s+\S+/mi),(text.match(/^\s*(?:logging|syslog).*$/mi)||['Syslog remoto ausente'])[0]),
    result({ruleKey:'dc_snmp_secure',title:'SNMP sem comunidades padrão',category:'Monitoramento',severity:'high',recommendation:'Prefira SNMPv3 e remova public/private.',remediationPreview:'Revisar integração Zabbix antes da alteração.'},!contains(text,/^\s*snmp-server community\s+(?:public|private)\b/mi),'Comunidades padrão'),
    result({ruleKey:'dc_vty_acl',title:'Acesso de gestão restrito',category:'Acesso',severity:'critical',recommendation:'Restrinja VTY/SSH à rede de gestão.',remediationPreview:'Aplicar ACL de gestão conforme versão DMOS.'},contains(text,/^\s*(?:access-class|access-group)\s+\S+\s+in/mi),(text.match(/^\s*(?:access-class|access-group).*$/mi)||['ACL de gestão ausente'])[0]),
    result({ruleKey:'dc_user',title:'Usuário administrativo individual',category:'Identidade',severity:'high',recommendation:'Utilize contas individualizadas.',remediationPreview:'Revisar usuários e contingência antes da aplicação.'},contains(text,/^\s*username\s+\S+/mi),(text.match(/^\s*username.*$/mi)||['Usuário não localizado'])[0]),
  ];
}

export function evaluateNokiaCompliance(configuration){
  const text=String(configuration);
  return[
    result({ruleKey:'nk_name',title:'System name configurado',category:'Identidade',severity:'medium',recommendation:'Defina nome único conforme inventário.',remediationPreview:'/configure system name <NOME>'},contains(text,/(?:^|\n)\s*(?:\/configure\s+)?system\s+(?:name|name\s*=)\s*"?\S+/mi),(text.match(/^\s*(?:\/configure\s+)?system\s+name.*$/mi)||['System name ausente'])[0]),
    result({ruleKey:'nk_ssh',title:'SSH habilitado',category:'Acesso',severity:'critical',recommendation:'Mantenha SSH habilitado e restrito.',remediationPreview:'Revisar SSH no contexto system security.'},contains(text,/\bssh\b[\s\S]{0,100}\b(?:server|administrative-state)\b/mi)||contains(text,/\bssh-server\b/mi),'Configuração SSH'),
    result({ruleKey:'nk_no_telnet',title:'Telnet desabilitado',category:'Acesso',severity:'critical',recommendation:'Desabilite Telnet.',remediationPreview:'Revisar Telnet no contexto system security.'},!contains(text,/\btelnet\b[\s\S]{0,80}\b(?:enable|administrative-state enable)\b/mi),'Estado do Telnet'),
    result({ruleKey:'nk_ntp',title:'NTP configurado',category:'Tempo',severity:'high',recommendation:'Configure servidores NTP confiáveis.',remediationPreview:'/configure system time ntp server <IP>'},contains(text,/\bntp\b[\s\S]{0,120}\bserver\b/mi),'Configuração NTP'),
    result({ruleKey:'nk_syslog',title:'Syslog remoto configurado',category:'Logs',severity:'medium',recommendation:'Envie eventos ao coletor central.',remediationPreview:'Revisar log-id e syslog destination.'},contains(text,/\bsyslog\b[\s\S]{0,120}\b(?:address|destination)\b/mi),'Destino syslog'),
    result({ruleKey:'nk_snmp_secure',title:'SNMP sem comunidades padrão',category:'Monitoramento',severity:'high',recommendation:'Prefira SNMPv3.',remediationPreview:'Revisar integração Zabbix.'},!contains(text,/\bcommunity\b\s+"?(?:public|private)"?/mi),'Comunidades padrão'),
    result({ruleKey:'nk_mgmt_filter',title:'Filtro de gestão configurado',category:'Acesso',severity:'critical',recommendation:'Restrinja serviços de gestão por filtro CPM.',remediationPreview:'Planejar CPM filter conforme versão SR OS.'},contains(text,/\bcpm-filter\b|\bmanagement-access-filter\b/mi),'Filtro CPM/gestão'),
    result({ruleKey:'nk_user',title:'Usuário administrativo individual',category:'Identidade',severity:'high',recommendation:'Utilize contas individualizadas ou AAA.',remediationPreview:'Revisar usuários, TACACS/RADIUS e contingência.'},contains(text,/\buser\b\s+"?\S+/mi)||contains(text,/\b(?:tacplus|radius)\b/mi),'Usuário/AAA'),
  ];
}

export function evaluateLinuxCompliance(configuration){
  const text=String(configuration);
  return[
    result({ruleKey:'lx_os',title:'Sistema operacional identificado',category:'Inventário',severity:'medium',recommendation:'Mantenha /etc/os-release disponível.',remediationPreview:'Revisar imagem e inventário do servidor.'},contains(text,/^(?:PRETTY_NAME|NAME|ID)=/mi),(text.match(/^PRETTY_NAME=.*$/mi)||['Distribuição não identificada'])[0]),
    result({ruleKey:'lx_ssh',title:'Serviço SSH habilitado',category:'Acesso',severity:'critical',recommendation:'Mantenha SSH gerenciado e restrito.',remediationPreview:'Revisar sshd e firewall antes de alterar.'},contains(text,/(?:ssh|sshd)\.service\s+enabled/mi),'Estado do serviço SSH'),
    result({ruleKey:'lx_firewall',title:'Firewall de host habilitado',category:'Firewall',severity:'critical',recommendation:'Habilite nftables, firewalld ou ufw.',remediationPreview:'Planejar regras e contingência antes de habilitar.'},contains(text,/(?:nftables|firewalld|ufw)\.service\s+enabled/mi),'Serviço de firewall'),
    result({ruleKey:'lx_time',title:'Sincronização de horário habilitada',category:'Tempo',severity:'high',recommendation:'Habilite chrony, ntpd ou systemd-timesyncd.',remediationPreview:'Configurar fontes de tempo confiáveis.'},contains(text,/(?:chrony|chronyd|ntp|ntpd|systemd-timesyncd)\.service\s+enabled/mi),'Serviço de horário'),
    result({ruleKey:'lx_logging',title:'Serviço de logs habilitado',category:'Logs',severity:'high',recommendation:'Mantenha journald/rsyslog e envio remoto conforme política.',remediationPreview:'Revisar retenção e destino remoto.'},contains(text,/(?:rsyslog|systemd-journald)\.service\s+(?:enabled|static)/mi),'Serviço de logs'),
    result({ruleKey:'lx_default_route',title:'Rota padrão configurada',category:'Rede',severity:'medium',recommendation:'Confirme gateway e redundância de gestão.',remediationPreview:'Revisar conectividade antes de alterar rotas.'},contains(text,/^default via\s+\S+/mi),(text.match(/^default via.*$/mi)||['Rota padrão ausente'])[0]),
  ];
}

export function complianceScore(findings) {
  const total = findings.reduce((sum, item) => sum + weights[item.severity], 0);
  const passed = findings.filter(item => ['compliant','excepted'].includes(item.status)).reduce((sum, item) => sum + weights[item.severity], 0);
  return total ? Math.round((passed / total) * 100) : 0;
}

export function compareComplianceFindings(findings, previousFindings = []) {
  const normalized = status => status === 'excepted' ? 'compliant' : status;
  const previous = new Map(previousFindings.map(item => [item.ruleKey, normalized(item.status)]));
  return findings.map(item => {
    const before = previous.get(item.ruleKey);
    const current = normalized(item.status);
    let change = 'unchanged';
    if (before === 'compliant' && current === 'non_compliant') change = 'regressed';
    else if (before === 'non_compliant' && current === 'compliant') change = 'recovered';
    else if (!before && current === 'non_compliant') change = 'new_non_compliant';
    return { ...item, change };
  });
}

export function applyComplianceExceptions(findings, exceptions = [], now = new Date()) {
  const active = new Map(exceptions.filter(item=>!item.revokedAt&&new Date(item.startsAt)<=now&&new Date(item.expiresAt)>now).map(item=>[item.ruleKey,item]));
  return findings.map(item=>{
    const exception=active.get(item.ruleKey);
    if(!exception||item.status!=='non_compliant')return item;
    return {...item,status:'excepted',exceptionId:exception.id,evidence:`Exceção aceita até ${new Date(exception.expiresAt).toISOString()}. Motivo: ${exception.reason}. Evidência original: ${item.evidence||'não informada'}`.slice(0,1200)};
  });
}

const baselineFor = type => type === 'huawei_vrp' ? evaluateHuaweiCompliance('') : type === 'cisco_ios' ? evaluateCiscoCompliance('') : type === 'juniper_junos' ? evaluateJuniperCompliance('') : type === 'fortigate_fortios' ? evaluateFortiGateCompliance('') : type === 'ubiquiti_edgeos' ? evaluateEdgeOsCompliance('') : type === 'datacom_dmos' ? evaluateDatacomCompliance('') : type === 'nokia_sros' ? evaluateNokiaCompliance('') : type === 'linux' ? evaluateLinuxCompliance('') : evaluateMikrotikCompliance('');

export async function ensureComplianceProfiles() {
  for (const deviceType of ['mikrotik','huawei_vrp','cisco_ios','juniper_junos','fortigate_fortios','ubiquiti_edgeos','datacom_dmos','nokia_sros','linux']) {
    let profile = await prisma.complianceProfile.findUnique({where:{name_deviceType:{name:defaultProfileNames[deviceType],deviceType}}});
    if (!profile) profile = await prisma.complianceProfile.create({data:{name:defaultProfileNames[deviceType],description:'Perfil padrão de segurança fornecido pelo NOC Agent.',deviceType,isSystem:true,minimumScore:80,createdBy:'system'}});
    const defaults = baselineFor(deviceType);
    for (const [position, rule] of defaults.entries()) {
      await prisma.complianceRule.upsert({
        where:{profileId_ruleKey:{profileId:profile.id,ruleKey:rule.ruleKey}},
        update:{},
        create:{profileId:profile.id,ruleKey:rule.ruleKey,title:rule.title,category:rule.category,severity:rule.severity,recommendation:rule.recommendation,remediationPreview:rule.remediationPreview,position},
      });
    }
    await prisma.compliancePolicy.updateMany({
      where:{profileId:null,device:{type:deviceType}},
      data:{profileId:profile.id,profile:profile.name},
    });
  }
}

export async function getComplianceProfiles(deviceType) {
  await ensureComplianceProfiles();
  return prisma.complianceProfile.findMany({
    where:{...(deviceType&&{deviceType}),isActive:true},
    include:{rules:{orderBy:[{position:'asc'},{title:'asc'}]},_count:{select:{policies:true}}},
    orderBy:[{deviceType:'asc'},{isSystem:'desc'},{name:'asc'}],
  });
}

export function applyComplianceProfile(findings, rules = [], configuration = '') {
  if (!rules.length) return findings;
  const base = new Map(findings.map(item=>[item.ruleKey,item]));
  const source = String(configuration).toLowerCase();
  return rules.filter(rule=>rule.enabled).map(rule=>{
    const current = base.get(rule.ruleKey) || result(rule,false,'Regra não suportada pelo avaliador deste fabricante');
    const expected = String(rule.expectedValue || '').split(/[,\n]/).map(item=>item.trim()).filter(Boolean);
    const missing = expected.filter(value=>!source.includes(value.toLowerCase()));
    return {
      ...current,
      title:rule.title,
      category:rule.category,
      severity:weights[rule.severity] ? rule.severity : current.severity,
      recommendation:rule.recommendation,
      remediationPreview:rule.remediationPreview,
      status:missing.length ? 'non_compliant' : current.status,
      evidence:missing.length ? `Valor(es) esperado(s) não localizado(s): ${missing.join(', ')}. ${current.evidence || ''}`.slice(0,1200) : current.evidence,
    };
  });
}

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Math.min(Math.max(Number.isFinite(number) ? number : fallback, min), max);
};

export function nextComplianceAt(policy, from = new Date()) {
  const next = new Date(from);
  next.setMinutes(0, 0, 0);
  next.setHours(clamp(policy.hour, 0, 23, 3));
  if (policy.frequency === 'weekly') {
    const target = clamp(policy.weekday, 0, 6, 1);
    let days = (target - next.getDay() + 7) % 7;
    if (days === 0 && next <= from) days = 7;
    next.setDate(next.getDate() + days);
  } else if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}

export async function saveCompliancePolicy(deviceId, input) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || !['mikrotik','huawei_vrp','cisco_ios','juniper_junos','fortigate_fortios','ubiquiti_edgeos','datacom_dmos','nokia_sros','linux'].includes(device.type)) throw Object.assign(new Error('Equipamento compatível com compliance não encontrado'), { statusCode: 404 });
  await ensureComplianceProfiles();
  const selected = input.profileId ? await prisma.complianceProfile.findFirst({where:{id:String(input.profileId),deviceType:device.type,isActive:true}}) : await prisma.complianceProfile.findFirst({where:{deviceType:device.type,isSystem:true,isActive:true},orderBy:{createdAt:'asc'}});
  if (!selected) throw Object.assign(new Error('Perfil de compliance compatível não encontrado'), {statusCode:400});
  const data = { enabled: input.enabled === true || input.enabled === 'true', frequency: input.frequency === 'weekly' ? 'weekly' : 'daily', hour: clamp(input.hour,0,23,3), weekday: clamp(input.weekday,0,6,1), alertEnabled: input.alertEnabled !== false && input.alertEnabled !== 'false', minimumScore: clamp(input.minimumScore,1,100,selected.minimumScore), profile: selected.name, profileId:selected.id };
  data.nextRunAt = data.enabled ? nextComplianceAt(data) : null;
  return prisma.compliancePolicy.upsert({ where:{deviceId}, update:data, create:{deviceId,...data} });
}

const openTaskStatuses = ['pending','in_progress','diagnosing','awaiting_approval','executing'];
const priorityRank = { low:0, medium:1, high:2, critical:3 };

function complianceAlertMessage(device, score, previousScore, findings, reason) {
  const affected = findings.filter(item => ['regressed','new_non_compliant'].includes(item.change));
  return [
    `Alerta de compliance no equipamento ${device.name} (${device.hostname}).`,
    `Motivo: ${reason}.`,
    `Pontuação: ${score}%${previousScore === null || previousScore === undefined ? '' : ` (anterior: ${previousScore}%)`}.`,
    affected.length ? `Controles afetados:\n${affected.map(item => `- [${item.severity.toUpperCase()}] ${item.title}: ${item.recommendation}`).join('\n')}` : '',
    'A verificação foi somente leitura. Revise as evidências na página Compliance antes de aplicar qualquer correção.',
  ].filter(Boolean).join('\n');
}

async function openOrUpdateComplianceTask(device, { score, previousScore, findings, reason, priority }) {
  const incidentKey = `compliance:${device.id}`;
  const originalMessage = complianceAlertMessage(device, score, previousScore, findings, reason);
  const existing = await prisma.task.findFirst({ where:{incidentKey,status:{in:openTaskStatuses}}, orderBy:{updatedAt:'desc'}, include:{device:true} });
  if (existing) {
    const nextPriority = priorityRank[priority] > priorityRank[existing.priority] ? priority : existing.priority;
    const task = await updateTask(existing.id,{status:'pending',priority:nextPriority,originalMessage,lastSeenAt:new Date(),occurrenceCount:{increment:1}});
    await addTaskMessage(task.id,'system',`Nova regressão de compliance detectada.\n${originalMessage}`);
    await notifyTask(task,'reopened',{message:originalMessage});
    return task;
  }
  const task = await createTask({source:'compliance',workType:'incident',deviceId:device.id,priority,originalMessage,incident:{incidentKey,incidentOpenedAt:new Date(),lastSeenAt:new Date()}});
  await addTaskMessage(task.id,'system',`Verificação de compliance: ${reason}.`);
  await notifyTask(task,'opened',{message:originalMessage});
  return task;
}

async function resolveComplianceTask(device, score) {
  const task = await prisma.task.findFirst({where:{incidentKey:`compliance:${device.id}`,status:{in:openTaskStatuses}},orderBy:{updatedAt:'desc'},include:{device:true}});
  if (!task) return null;
  const note = `Compliance restaurado automaticamente: pontuação ${score}%, sem controles não conformes.`;
  const updated = await updateTask(task.id,{status:'resolved',resolvedAt:new Date(),resolutionSummary:note,resolutionType:'automatic_validation'});
  await addTaskMessage(updated.id,'system',note);
  await notifyTask(updated,'resolved',{message:note});
  return updated;
}

export async function runComplianceScan(deviceId, { type='manual', username='system', validationTaskId=null } = {}) {
  if (running.has(deviceId)) throw Object.assign(new Error('Já existe uma verificação em execução para este equipamento'), { statusCode: 409 });
  running.add(deviceId);
  let scan;
  let device;
  let previousScan;
  try {
    device = await prisma.device.findUnique({ where:{id:deviceId} });
    if (!device || !device.isActive || !['mikrotik','huawei_vrp','cisco_ios','juniper_junos','fortigate_fortios','ubiquiti_edgeos','datacom_dmos','nokia_sros','linux'].includes(device.type)) throw Object.assign(new Error('Equipamento compatível não encontrado ou inativo'), { statusCode:404 });
    previousScan = await prisma.complianceScan.findFirst({where:{deviceId,status:'completed'},orderBy:{startedAt:'desc'},include:{findings:true}});
    await ensureComplianceProfiles();
    const policy = await prisma.compliancePolicy.findUnique({where:{deviceId},include:{complianceProfile:{include:{rules:{orderBy:{position:'asc'}}}}}});
    const scope = await prisma.complianceScopePolicy.findFirst({
      where:{isActive:true,profile:{deviceType:device.type},OR:[{devices:{some:{id:device.id}}},...(device.group?[{deviceGroup:device.group}]:[])]},
      include:{profile:{include:{rules:{orderBy:{position:'asc'}}}}},
      orderBy:{priority:'asc'},
    });
    const profile = scope?.profile || policy?.complianceProfile || await prisma.complianceProfile.findFirst({where:{deviceType:device.type,isSystem:true,isActive:true},include:{rules:{orderBy:{position:'asc'}}}});
    scan = await prisma.complianceScan.create({ data:{deviceId,type,profile:profile?.name || COMPLIANCE_PROFILE,status:'running',createdBy:username,validationTaskId} });
    const capture = await captureDeviceConfiguration(device);
    if (!capture.success) throw Object.assign(new Error(capture.output || 'Falha ao consultar configuração'), { statusCode: 502 });
    const configurationSha256 = crypto.createHash('sha256').update(String(capture.output)).digest('hex');
    const baseline = device.type === 'mikrotik' ? evaluateMikrotikCompliance(capture.output) : device.type === 'cisco_ios' ? evaluateCiscoCompliance(capture.output) : device.type === 'juniper_junos' ? evaluateJuniperCompliance(capture.output) : device.type === 'fortigate_fortios' ? evaluateFortiGateCompliance(capture.output) : device.type === 'ubiquiti_edgeos' ? evaluateEdgeOsCompliance(capture.output) : device.type === 'datacom_dmos' ? evaluateDatacomCompliance(capture.output) : device.type === 'nokia_sros' ? evaluateNokiaCompliance(capture.output) : device.type === 'linux' ? evaluateLinuxCompliance(capture.output) : evaluateHuaweiCompliance(capture.output);
    const evaluated = applyComplianceProfile(baseline,profile?.rules,capture.output);
    const exceptions = await prisma.complianceException.findMany({where:{deviceId,revokedAt:null,startsAt:{lte:new Date()},expiresAt:{gt:new Date()}}});
    const findings = compareComplianceFindings(applyComplianceExceptions(evaluated,exceptions), previousScan?.findings);
    const score = complianceScore(findings);
    const passed = findings.filter(item=>['compliant','excepted'].includes(item.status)).length;
    const failed = findings.length - passed;
    const regressions = findings.filter(item=>item.change==='regressed').length;
    const recoveries = findings.filter(item=>item.change==='recovered').length;
    await prisma.$transaction([
      prisma.complianceFinding.createMany({ data: findings.map(item=>({scanId:scan.id,ruleKey:item.ruleKey,title:item.title,category:item.category,severity:item.severity,status:item.status,change:item.change,exceptionId:item.exceptionId||null,evidence:item.evidence,recommendation:item.recommendation,remediationPreview:item.remediationPreview})) }),
      prisma.complianceScan.update({where:{id:scan.id},data:{status:'completed',score,previousScore:previousScan?.score ?? null,passed,failed,regressions,recoveries,configurationSha256,completedAt:new Date()}}),
    ]);
    if (policy) await prisma.compliancePolicy.update({where:{deviceId},data:{lastRunAt:new Date(),lastStatus:'completed',lastScore:score,lastError:null,...(type==='automatic'&&{nextRunAt:nextComplianceAt(policy,new Date(Date.now()+60_000))})}});
    const highRisk = findings.filter(item=>['regressed','new_non_compliant'].includes(item.change) && ['critical','high'].includes(item.severity));
    const minimumScore = policy?.minimumScore ?? 80;
    const crossedThreshold = score < minimumScore && (previousScan?.score === null || previousScan?.score === undefined || previousScan.score >= minimumScore);
    let alertTask = null;
    if ((policy?.alertEnabled ?? true) && (highRisk.length || regressions || crossedThreshold)) {
      const critical = highRisk.some(item=>item.severity==='critical');
      const reason = regressions ? `${regressions} regressão(ões) em relação à verificação anterior` : highRisk.length ? `${highRisk.length} controle(s) crítico(s) ou alto(s) não conforme(s)` : `pontuação abaixo da meta de ${minimumScore}%`;
      alertTask = await openOrUpdateComplianceTask(device,{score,previousScore:previousScan?.score,findings,reason,priority:critical?'critical':'high'});
      await prisma.complianceScan.update({where:{id:scan.id},data:{alertTaskId:alertTask.id}});
    } else if (failed===0 && previousScan?.failed) {
      alertTask = await resolveComplianceTask(device,score);
      if(alertTask) await prisma.complianceScan.update({where:{id:scan.id},data:{alertTaskId:alertTask.id}});
    }
    await logAudit({username,displayName:username==='system'?'Agendador de compliance':username,role:username==='system'?'system':'admin',action:validationTaskId?'post_remediation_validation':'scan',resource:'compliance',resourceId:scan.id,status:'success',details:{deviceId,deviceName:device.name,score,passed,failed,regressions,recoveries,alertTaskId:alertTask?.id,validationTaskId,configurationSha256,type,scopePolicy:scope?.name||null}});
    return prisma.complianceScan.findUnique({where:{id:scan.id},include:{findings:true}});
  } catch(error) {
    if (scan) await prisma.complianceScan.update({where:{id:scan.id},data:{status:'failed',error:error.message.slice(0,2000),completedAt:new Date()}}).catch(()=>{});
    const policy = device ? await prisma.compliancePolicy.findUnique({where:{deviceId}}) : null;
    if (policy) await prisma.compliancePolicy.update({where:{deviceId},data:{lastRunAt:new Date(),lastStatus:'failed',lastError:error.message.slice(0,1000),...(type==='automatic'&&{nextRunAt:nextComplianceAt(policy,new Date(Date.now()+60_000))})}});
    if (!error.statusCode && /conexão SSH|Handshake failed|timed out|ECONN/i.test(error.message)) error.statusCode = 502;
    throw error;
  } finally { running.delete(deviceId); }
}

export async function runComplianceScheduler() {
  const due = await prisma.compliancePolicy.findMany({where:{enabled:true,nextRunAt:{lte:new Date()},device:{isActive:true,type:{in:['mikrotik','huawei_vrp','cisco_ios','juniper_junos','fortigate_fortios','ubiquiti_edgeos','datacom_dmos','nokia_sros','linux']}}},select:{deviceId:true}});
  for (const item of due) {
    if (running.has(item.deviceId)) continue;
    await runComplianceScan(item.deviceId,{type:'automatic',username:'system'}).catch(error=>logger.error(`Compliance ${item.deviceId}: ${error.message}`));
  }
}

export function complianceReminderThreshold(expiresAt, now=new Date()){
  const remaining=(new Date(expiresAt).getTime()-now.getTime())/86400000;
  if(remaining<=0||remaining>7)return null;
  return remaining<=1?1:remaining<=3?3:7;
}

export const remediationNeedsPlanning = preview => /<[^>]+>|revisar|baseline aprovado|antes da aplicação/i.test(String(preview||''));

export async function runComplianceExceptionReminders(io = null) {
  const now=new Date();
  const exceptions=await prisma.complianceException.findMany({
    where:{revokedAt:null,startsAt:{lte:now},expiresAt:{gt:now,lte:new Date(now.getTime()+7*86400000)}},
    include:{device:{select:{name:true,hostname:true}}},
  });
  const results=[];
  for(const exception of exceptions){
    const thresholdDays=complianceReminderThreshold(exception.expiresAt,now);
    if(!thresholdDays)continue;
    results.push(...await notifyComplianceException(exception,thresholdDays,io));
  }
  return results;
}

export async function runComplianceEscalations(io = null) {
  const settings = await prisma.settings.findMany({where:{key:{in:['compliance_escalation_level1_hours','compliance_escalation_level2_hours','compliance_escalation_level3_hours']}}});
  const values = Object.fromEntries(settings.map(item=>[item.key,Number(item.value)]));
  const thresholds = [values.compliance_escalation_level1_hours||4,values.compliance_escalation_level2_hours||12,values.compliance_escalation_level3_hours||24];
  const tasks = await prisma.task.findMany({where:{source:'compliance',status:{in:openTaskStatuses}},include:{device:true}});
  const results=[];
  for(const task of tasks){
    const ageHours=(Date.now()-new Date(task.incidentOpenedAt||task.createdAt).getTime())/3600000;
    let level=0;
    thresholds.forEach((hours,index)=>{if(ageHours>=hours)level=index+1;});
    if(level<=task.escalationLevel)continue;
    const message=`Escalonamento de Compliance nível ${level}: Task aberta há ${Math.floor(ageHours)}h, prioridade ${task.priority}, responsável ${task.assignedTo||'não atribuído'}.`;
    const updated=await updateTask(task.id,{escalationLevel:level});
    await addTaskMessage(task.id,'system',message);
    results.push(...await notifyTask(updated,`compliance_escalation_l${level}`,{message,io}));
    await logAudit({username:'system',displayName:'Escalonamento de compliance',role:'system',action:'escalate',resource:'task',resourceId:task.id,status:'success',details:{taskNumber:task.taskNumber,level,ageHours:Math.floor(ageHours)}});
  }
  return results;
}

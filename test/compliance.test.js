import test from 'node:test';
import assert from 'node:assert/strict';
import { applyComplianceExceptions, applyComplianceProfile, compareComplianceFindings, complianceReminderThreshold, complianceScore, evaluateHuaweiCompliance, evaluateMikrotikCompliance, nextComplianceAt, remediationNeedsPlanning } from '../src/services/compliance.service.js';

test('avalia controles essenciais do RouterOS exportado por seções', () => {
  const findings = evaluateMikrotikCompliance(`
/system identity
set name=RB-NOC-01
/system ntp client
set enabled=yes
/ip dns
set allow-remote-requests=no
/ip service
set telnet disabled=yes
set ftp disabled=yes
set api disabled=yes
/tool mac-server mac-winbox
set allowed-interface-list=Rede-Permitidas
/ip firewall filter
add chain=input action=accept comment="gestao"
/ip ssh
set strong-crypto=yes
/snmp
set enabled=yes
/system logging action
add name=remote-noc target=remote remote=10.0.0.20
`);
  assert.equal(findings.length, 12);
  assert.equal(findings.find(item => item.ruleKey === 'mt_telnet').status, 'compliant');
  assert.equal(findings.find(item => item.ruleKey === 'mt_mac_winbox').status, 'compliant');
  assert.equal(findings.every(item => item.status === 'compliant'), true);
  assert.equal(complianceScore(findings), 100);
});

test('detecta exposição de serviços no RouterOS', () => {
  const findings = evaluateMikrotikCompliance('/system identity set name=MikroTik\n/ip dns set allow-remote-requests=yes\n/tool mac-server mac-winbox set allowed-interface-list=all');
  for (const key of ['mt_identity','mt_dns_remote','mt_telnet','mt_mac_winbox','mt_firewall_input']) {
    assert.equal(findings.find(item => item.ruleKey === key).status, 'non_compliant');
  }
  assert.ok(complianceScore(findings) < 50);
});

test('avalia baseline Huawei sem considerar Telnet ausente como habilitado', () => {
  const findings = evaluateHuaweiCompliance(`
sysname NE8000-NOC
ntp-service unicast-server 10.0.0.10
stelnet server enable
ssh server-source -i LoopBack0
snmp-agent
info-center loghost 10.0.0.20
aaa
user-interface vty 0 4
 acl 2000 inbound
password policy administrator
interface LoopBack0
`);
  assert.equal(findings.length, 11);
  assert.equal(findings.every(item => item.status === 'compliant'), true);
  assert.equal(complianceScore(findings), 100);
});

test('calcula próxima execução diária e semanal', () => {
  const daily = nextComplianceAt({ frequency:'daily', hour:3 }, new Date(2026, 6, 28, 4));
  const weekly = nextComplianceAt({ frequency:'weekly', hour:2, weekday:5 }, new Date(2026, 6, 28, 12));
  assert.deepEqual([daily.getDate(), daily.getHours()], [29, 3]);
  assert.deepEqual([weekly.getDay(), weekly.getDate(), weekly.getHours()], [5, 31, 2]);
});

test('classifica regressões, recuperações e novos desvios', () => {
  const current = [
    { ruleKey:'a', status:'non_compliant' },
    { ruleKey:'b', status:'compliant' },
    { ruleKey:'c', status:'non_compliant' },
    { ruleKey:'d', status:'compliant' },
  ];
  const previous = [
    { ruleKey:'a', status:'compliant' },
    { ruleKey:'b', status:'non_compliant' },
    { ruleKey:'d', status:'compliant' },
  ];
  const compared = compareComplianceFindings(current, previous);
  assert.deepEqual(compared.map(item=>item.change), ['regressed','recovered','new_non_compliant','unchanged']);
});

test('perfil desativa regras, altera severidade e exige valores personalizados', () => {
  const baseline = evaluateMikrotikCompliance('/system identity set name=RB-01\n/system ntp client set enabled=yes');
  const rules = [
    { ...baseline.find(item=>item.ruleKey==='mt_identity'), enabled:false },
    { ...baseline.find(item=>item.ruleKey==='mt_ntp'), enabled:true, severity:'critical', expectedValue:'10.0.0.10' },
  ];
  const applied = applyComplianceProfile(baseline,rules,'/system ntp client set enabled=yes');
  assert.equal(applied.length,1);
  assert.equal(applied[0].ruleKey,'mt_ntp');
  assert.equal(applied[0].severity,'critical');
  assert.equal(applied[0].status,'non_compliant');
  assert.match(applied[0].evidence,/10\.0\.0\.10/);
});

test('exceção ativa neutraliza desvio e exceção vencida não altera resultado', () => {
  const now = new Date('2026-07-28T12:00:00Z');
  const finding = { ruleKey:'mt_telnet', status:'non_compliant', severity:'critical', evidence:'Telnet ativo' };
  const active = applyComplianceExceptions([finding],[{id:'ex-1',ruleKey:'mt_telnet',reason:'Equipamento legado em migração',startsAt:'2026-07-27T12:00:00Z',expiresAt:'2026-07-29T12:00:00Z',revokedAt:null}],now);
  const expired = applyComplianceExceptions([finding],[{id:'ex-2',ruleKey:'mt_telnet',reason:'Janela encerrada',startsAt:'2026-07-20T12:00:00Z',expiresAt:'2026-07-27T12:00:00Z',revokedAt:null}],now);
  assert.equal(active[0].status,'excepted');
  assert.equal(active[0].exceptionId,'ex-1');
  assert.equal(complianceScore(active),100);
  assert.equal(expired[0].status,'non_compliant');
});

test('classifica lembretes de exceção nas janelas de 7, 3 e 1 dia', () => {
  const now=new Date('2026-07-28T12:00:00Z');
  assert.equal(complianceReminderThreshold('2026-08-03T12:00:00Z',now),7);
  assert.equal(complianceReminderThreshold('2026-07-31T12:00:00Z',now),3);
  assert.equal(complianceReminderThreshold('2026-07-29T12:00:00Z',now),1);
  assert.equal(complianceReminderThreshold('2026-08-10T12:00:00Z',now),null);
});

test('exige preparação do especialista quando a correção possui placeholders', () => {
  assert.equal(remediationNeedsPlanning('/system identity set name=<NOME-PADRAO>'),true);
  assert.equal(remediationNeedsPlanning('/ip service disable telnet'),false);
});

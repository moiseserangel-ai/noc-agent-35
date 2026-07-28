import test from 'node:test';
import assert from 'node:assert/strict';
import { complianceReportCsv, complianceReportPdf } from '../src/services/compliance-report.service.js';

const report = {
  generatedAt:new Date('2026-07-28T12:00:00Z'),
  range:{from:new Date('2026-07-01T00:00:00Z'),to:new Date('2026-07-28T23:59:59Z')},
  summary:{scans:1,devices:1,averageScore:88,nonCompliant:1,regressions:1,accepted:0,exceptions:1},
  scans:[{score:88,profile:'MikroTik - Baseline NOC',passed:7,failed:1,regressions:1,recoveries:0,startedAt:new Date('2026-07-28T10:00:00Z'),device:{name:'RB-01'}}],
  findings:[{scanDate:new Date('2026-07-28T10:00:00Z'),scanProfile:'MikroTik - Baseline NOC',scanScore:88,title:'Telnet desabilitado',category:'Acesso',severity:'critical',status:'non_compliant',change:'regressed',evidence:'Telnet ativo',recommendation:'Desabilite Telnet',exceptionId:null,device:{name:'RB-01',hostname:'10.0.0.1',group:'Borda'}}],
  exceptions:[{ruleKey:'mt_api',reason:'=não executar fórmula',approvedBy:'admin',startsAt:new Date('2026-07-20T10:00:00Z'),expiresAt:new Date('2026-08-20T10:00:00Z'),revokedAt:null,device:{name:'RB-01'}}],
};

test('gera CSV de compliance compatível com Excel e protege fórmulas', () => {
  const csv = complianceReportCsv({...report,findings:[{...report.findings[0],evidence:'=HYPERLINK("x")'}]}).toString('utf8');
  assert.ok(csv.startsWith('\ufeff'));
  assert.match(csv,/Equipamento/);
  assert.match(csv,/'=HYPERLINK/);
});

test('gera documento PDF válido com resumo e evidências', async () => {
  const pdf = await complianceReportPdf(report,{name:'NOC Teste',primaryColor:'#0088aa'});
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.ok(pdf.length>1000);
});

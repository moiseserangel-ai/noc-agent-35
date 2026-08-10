import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProposalWithConfiguration, extractProposedCommands } from '../src/services/proposal-comparison.service.js';

test('extracts RouterOS commands and ignores explanatory text',()=>{
  const commands=extractProposedCommands('Plano:\n```routeros\n/ip firewall filter add chain=input action=accept comment=agent\n/ip firewall filter remove [find comment=old]\n```\nValidação: conferir regras.');
  assert.deepEqual(commands,['/ip firewall filter add chain=input action=accept comment=agent','/ip firewall filter remove [find comment=old]']);
});

test('classifies present, change and destructive proposal commands',()=>{
  const result=compareProposalWithConfiguration('/ip firewall filter\nadd chain=input action=accept comment=agent','/ip firewall filter add chain=input action=accept comment=agent\n/ip firewall filter add chain=forward action=accept comment=new\n/ip firewall filter remove [find comment=old]');
  assert.equal(result.summary.present,1);
  assert.equal(result.summary.changes,1);
  assert.equal(result.summary.removals,1);
  assert.equal(result.warnings.length,1);
});

test('masks credentials before returning proposed commands',()=>{
  const [command]=extractProposedCommands('set password=supersecret interface=wan');
  assert.equal(command,'set password=[PROTEGIDO] interface=wan');
});

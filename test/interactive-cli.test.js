import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedInteractiveCommand } from '../src/services/interactive-cli.service.js';

test('bloqueia comandos destrutivos diretos no terminal interativo', () => {
  assert.equal(isBlockedInteractiveCommand('/system reset-configuration'), true);
  assert.equal(isBlockedInteractiveCommand('reset saved-configuration'), true);
  assert.equal(isBlockedInteractiveCommand('rm -rf /'), true);
  assert.equal(isBlockedInteractiveCommand('reboot'), true);
  assert.equal(isBlockedInteractiveCommand('mkfs.ext4 /dev/sda'), true);
});

test('permite comandos operacionais comuns no terminal interativo', () => {
  assert.equal(isBlockedInteractiveCommand('/interface print'), false);
  assert.equal(isBlockedInteractiveCommand('display interface brief'), false);
  assert.equal(isBlockedInteractiveCommand('systemctl restart nginx'), false);
});

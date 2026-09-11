import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureJuniperNativeComments, validateJuniperCommands } from '../src/tools/ssh-juniper-junos.tool.js';
import { getDeviceTypeLabel, supportedDeviceTypes } from '../src/vendors/registry.js';

test('plugin Juniper Junos está registrado', () => {
  assert.ok(supportedDeviceTypes.includes('juniper_junos'));
  assert.equal(getDeviceTypeLabel('juniper_junos'), 'Juniper Junos');
});

test('política Junos permite diagnóstico e exige aprovação para mudança', () => {
  assert.equal(validateJuniperCommands('show version\nshow route summary', false).allowed, true);
  assert.equal(validateJuniperCommands('configure exclusive\nset system services ssh', false).allowed, false);
  assert.equal(validateJuniperCommands('configure exclusive\nset system services ssh', true).allowed, true);
});

test('política Junos bloqueia operações destrutivas mesmo aprovadas', () => {
  assert.equal(validateJuniperCommands('request system reboot', true).allowed, false);
  assert.equal(validateJuniperCommands('request system zeroize', true).allowed, false);
});

test('adiciona annotate nativo em mudança Junos', () => {
  const result = ensureJuniperNativeComments('set interfaces ge-0/0/0 description Uplink', 'Ativação do enlace principal');
  assert.match(result, /annotate interfaces ge-0\/0\/0 "Ativação do enlace principal"/);
});

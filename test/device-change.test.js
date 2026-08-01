import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChangeMarker, normalizeChangeComment } from '../src/services/device-change.service.js';
import { ensureMikrotikObjectComments, MIKROTIK_KEX_ALGORITHMS } from '../src/tools/ssh-mikrotik.tool.js';
import { ensureHuaweiNativeDescriptions } from '../src/tools/ssh-huawei-vrp.tool.js';

test('normaliza e identifica comentário de mudança', () => {
  assert.equal(normalizeChangeComment('  VLAN 400\nativada para o cliente  '), 'VLAN 400 ativada para o cliente');
  assert.equal(formatChangeMarker('VLAN 400 ativada', 123), 'NOC-Agent #TASK-123 — VLAN 400 ativada');
});

test('rejeita comentário ausente ou insuficiente', () => {
  assert.throws(() => normalizeChangeComment('feito'), /pelo menos 10/);
});

test('injeta comment nativo em objetos RouterOS compatíveis', () => {
  assert.equal(ensureMikrotikObjectComments('/ip address add address=10.0.0.10/24 interface=ether2', 'IP do servidor'), '/ip address add address=10.0.0.10/24 interface=ether2 comment="IP do servidor"');
  assert.equal(ensureMikrotikObjectComments('/ip firewall filter add chain=input action=drop', 'Drop geral'), '/ip firewall filter add chain=input action=drop comment="Drop geral"');
});

test('preserva comment RouterOS já informado e não comenta comandos singleton', () => {
  assert.equal(ensureMikrotikObjectComments('/ip route add dst-address=10.0.0.0/24 gateway=1.1.1.1 comment="Link filial"', 'Nova rota filial'), '/ip route add dst-address=10.0.0.0/24 gateway=1.1.1.1 comment="Link filial"');
  assert.equal(ensureMikrotikObjectComments('/system identity set name=CORE', 'Identidade do core'), '/system identity set name=CORE');
});

test('cliente MikroTik negocia algoritmos modernos e mantém compatibilidade legada', () => {
  assert.ok(MIKROTIK_KEX_ALGORITHMS.includes('curve25519-sha256'));
  assert.ok(MIKROTIK_KEX_ALGORITHMS.includes('diffie-hellman-group14-sha256'));
  assert.ok(MIKROTIK_KEX_ALGORITHMS.indexOf('curve25519-sha256') < MIKROTIK_KEX_ALGORITHMS.indexOf('diffie-hellman-group14-sha1'));
});

test('injeta description nativa em interface, rota e peer Huawei', () => {
  assert.equal(ensureHuaweiNativeDescriptions('system-view\ninterface 100GE1/0/0\nundo shutdown\ncommit', 'Link servidor'), 'system-view\ninterface 100GE1/0/0\ndescription Link servidor\nundo shutdown\ncommit');
  assert.equal(ensureHuaweiNativeDescriptions('ip route-static 10.0.0.0 24 192.0.2.1', 'Rota servidor'), 'ip route-static 10.0.0.0 24 192.0.2.1 description Rota servidor');
  assert.equal(ensureHuaweiNativeDescriptions('bgp 65000\npeer 192.0.2.2 as-number 65001', 'Peer trânsito'), 'bgp 65000\npeer 192.0.2.2 as-number 65001\npeer 192.0.2.2 description Peer trânsito');
});

test('preserva description Huawei já informada', () => {
  const commands='interface 100GE1/0/0\ndescription UPLINK EXISTENTE - NOC\nundo shutdown';
  assert.equal(ensureHuaweiNativeDescriptions(commands, 'Ativação do uplink'), commands);
});

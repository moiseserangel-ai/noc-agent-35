import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminRole, isOperatorRole, isViewerRole, validateScopedRole } from '../src/security/roles.js';

test('perfis globais e de empresa não podem trocar de escopo implicitamente',()=>{
  assert.equal(validateScopedRole('admin',null),'admin');
  assert.equal(validateScopedRole('tenant_admin','tenant-1'),'tenant_admin');
  assert.throws(()=>validateScopedRole('admin','tenant-1'),/perfil tenant_admin/i);
  assert.throws(()=>validateScopedRole('tenant_admin',null),/empresa vinculada/i);
});

test('hierarquia delegada mantém administração, operação e leitura separadas',()=>{
  assert.equal(isAdminRole('tenant_admin'),true);
  assert.equal(isOperatorRole('tenant_operator'),true);
  assert.equal(isViewerRole('tenant_viewer'),true);
  assert.equal(isAdminRole('tenant_operator'),false);
});

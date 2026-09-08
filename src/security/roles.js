export const GLOBAL_ROLES = ['admin','operator','viewer'];
export const TENANT_ROLES = ['tenant_admin','tenant_operator','tenant_viewer'];
export const ALL_ROLES = [...GLOBAL_ROLES,...TENANT_ROLES];
export const isTenantRole = role => TENANT_ROLES.includes(role);
export const isAdminRole = role => ['admin','tenant_admin'].includes(role);
export const isOperatorRole = role => ['admin','operator','tenant_admin','tenant_operator'].includes(role);
export const isViewerRole = role => ['viewer','tenant_viewer'].includes(role);

export function validateScopedRole(role,tenantId){
  if(!ALL_ROLES.includes(role))throw new Error('Perfil inválido');
  if(tenantId&&!isTenantRole(role))throw new Error('Usuários de empresa devem usar um perfil tenant_admin, tenant_operator ou tenant_viewer');
  if(!tenantId&&isTenantRole(role))throw new Error('Perfis de empresa exigem uma empresa vinculada');
  return role;
}

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function withApprovedRemediation(callback, metadata = {}) {
  return storage.run({ remediationApproved: true, ...metadata }, callback);
}

export function getExecutionContext() {
  return storage.getStore() || {};
}

export function isRemediationApproved() {
  return storage.getStore()?.remediationApproved === true;
}

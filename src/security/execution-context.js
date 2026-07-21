import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function withApprovedRemediation(callback) {
  return storage.run({ remediationApproved: true }, callback);
}

export function isRemediationApproved() {
  return storage.getStore()?.remediationApproved === true;
}

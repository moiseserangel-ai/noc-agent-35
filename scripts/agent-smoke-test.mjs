import { createSpecialistAgents, vendorPlugins } from '../src/vendors/registry.js';

const agents = createSpecialistAgents();
let failed = false;
for (const plugin of vendorPlugins) {
  const agent = agents[plugin.type];
  const tools = agent?.tools || [];
  const hasTool = plugin.type === 'unifi_controller' ? tools.length > 0 : tools.some(tool => /^ssh/i.test(tool.name));
  const ok = Boolean(agent && hasTool);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${plugin.type} (${tools.length} tools)`);
  if (!ok) failed = true;
}
if (failed) process.exitCode = 1;

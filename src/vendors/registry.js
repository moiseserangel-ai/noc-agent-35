import MikrotikAgent from '../agents/mikrotik-agent.js';
import LinuxAgent from '../agents/linux-agent.js';
import HuaweiVrpAgent from '../agents/huawei-vrp-agent.js';

export const vendorPlugins = [
  { type: 'mikrotik', label: 'MikroTik RouterOS', manufacturer: 'MikroTik', platform: 'RouterOS', Agent: MikrotikAgent },
  { type: 'linux', label: 'Linux', manufacturer: 'Comunidade', platform: 'Linux', Agent: LinuxAgent },
  { type: 'huawei_vrp', label: 'Huawei VRP / NetEngine', manufacturer: 'Huawei', platform: 'VRP', Agent: HuaweiVrpAgent },
];

export const supportedDeviceTypes = vendorPlugins.map(plugin => plugin.type);
export const isSupportedDeviceType = type => supportedDeviceTypes.includes(type);
export const getDeviceTypeLabel = type => vendorPlugins.find(plugin => plugin.type === type)?.label || type;
export const createSpecialistAgents = () => Object.fromEntries(vendorPlugins.map(plugin => [plugin.type, new plugin.Agent()]));
export const publicVendorPlugins = () => vendorPlugins.map(({ type, label, manufacturer, platform }) => ({ type, label, manufacturer, platform }));

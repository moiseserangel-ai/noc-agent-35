import MikrotikAgent from '../agents/mikrotik-agent.js';
import LinuxAgent from '../agents/linux-agent.js';
import HuaweiVrpAgent from '../agents/huawei-vrp-agent.js';
import CiscoIosAgent from '../agents/cisco-ios-agent.js';
import JuniperJunosAgent from '../agents/juniper-junos-agent.js';
import FortiGateFortiOsAgent from '../agents/fortigate-fortios-agent.js';
import UbiquitiEdgeOsAgent from '../agents/ubiquiti-edgeos-agent.js';
import UniFiControllerAgent from '../agents/unifi-controller-agent.js';
import { DatacomDmosAgent, NokiaSrosAgent } from '../agents/profiled-network-agent.js';

export const vendorPlugins = [
  { type: 'mikrotik', label: 'MikroTik RouterOS', manufacturer: 'MikroTik', platform: 'RouterOS', Agent: MikrotikAgent },
  { type: 'linux', label: 'Linux', manufacturer: 'Comunidade', platform: 'Linux', Agent: LinuxAgent },
  { type: 'huawei_vrp', label: 'Huawei VRP / NetEngine', manufacturer: 'Huawei', platform: 'VRP', Agent: HuaweiVrpAgent },
  { type: 'cisco_ios', label: 'Cisco IOS / IOS-XE', manufacturer: 'Cisco', platform: 'IOS-XE', Agent: CiscoIosAgent },
  { type: 'juniper_junos', label: 'Juniper Junos', manufacturer: 'Juniper', platform: 'Junos', Agent: JuniperJunosAgent },
  { type: 'fortigate_fortios', label: 'Fortinet FortiGate / FortiOS', manufacturer: 'Fortinet', platform: 'FortiOS', Agent: FortiGateFortiOsAgent },
  { type: 'ubiquiti_edgeos', label: 'Ubiquiti EdgeRouter / EdgeOS', manufacturer: 'Ubiquiti', platform: 'EdgeOS', Agent: UbiquitiEdgeOsAgent },
  { type: 'unifi_controller', label: 'Ubiquiti UniFi Controller', manufacturer: 'Ubiquiti', platform: 'UniFi OS', Agent: UniFiControllerAgent },
  { type: 'datacom_dmos', label: 'Datacom DMOS', manufacturer: 'Datacom', platform: 'DMOS', Agent: DatacomDmosAgent },
  { type: 'nokia_sros', label: 'Nokia SR OS', manufacturer: 'Nokia', platform: 'SR OS', Agent: NokiaSrosAgent },
];

export const supportedDeviceTypes = vendorPlugins.map(plugin => plugin.type);
export const isSupportedDeviceType = type => supportedDeviceTypes.includes(type);
export const getDeviceTypeLabel = type => vendorPlugins.find(plugin => plugin.type === type)?.label || type;
export const createSpecialistAgents = () => Object.fromEntries(vendorPlugins.map(plugin => [plugin.type, new plugin.Agent()]));
export const publicVendorPlugins = () => vendorPlugins.map(({ type, label, manufacturer, platform }) => ({ type, label, manufacturer, platform }));

import BaseAgent from './base-agent.js';
import { sshCiscoIosExec, sshCiscoIosToolDefinition } from '../tools/ssh-cisco-ios.tool.js';
import { pingHost, pingToolDefinition, tracerouteHost, tracerouteToolDefinition } from '../tools/network.tool.js';
import { getDeviceById } from '../services/device.service.js';
import { withApprovedRemediation } from '../security/execution-context.js';
import { configurationPlanningInstruction } from '../services/agent-approval-policy.service.js';
import { inferWorkType } from '../services/work-type.service.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT=`Você é especialista Cisco IOS e IOS-XE em um NOC.
- Responda sempre em português brasileiro e use exclusivamente sintaxe Cisco compatível com a plataforma cadastrada.
- No diagnóstico use somente show, ping e traceroute. Colete show version e evidências específicas quando necessário.
- Toda alteração exige Task e aprovação humana. Apresente comandos, riscos, validação e rollback antes de solicitar aprovação.
- Nunca execute reload, write erase, erase startup-config, format ou operações de instalação de imagem.
- Em mudança aprovada, use configure terminal apenas quando necessário, aplique o menor conjunto e valide com comandos show.
- Envie changeComment em toda alteração. Em interfaces, a ferramenta adiciona description nativa quando não houver uma explícita. Preserve descrições existentes importantes.
- Não grave startup-config automaticamente; só proponha copy running-config startup-config quando isso estiver explicitamente aprovado.
- Se houver erro de sintaxe, pare e reporte.
Consultas úteis: show version, show inventory, show interfaces status, show ip interface brief, show ip route, show arp, show mac address-table, show vlan brief, show cdp neighbors detail, show lldp neighbors detail, show logging.
Finalize propostas de alteração com "Responda com SIM para aplicar ou NÃO para cancelar." e #TASK-{taskNumber}.`;
const contextFor=async id=>{const d=await getDeviceById(id);return d?`Fabricante: ${d.manufacturer||'Cisco'}\nPlataforma: ${d.platform||'IOS-XE'}\nModelo: ${d.model||'não informado'}\nVersão: ${d.osVersion||'não informada'}\nCapacidades: ${d.capabilities||'não informadas'}`:'';};
export default class CiscoIosAgent extends BaseAgent{
  constructor(){super('cisco_ios',SYSTEM_PROMPT);this.registerTool(sshCiscoIosToolDefinition,sshCiscoIosExec);this.registerTool(pingToolDefinition,pingHost);this.registerTool(tracerouteToolDefinition,tracerouteHost);}
  async diagnose(deviceId,deviceName,request,taskNumber){try{return await this.run(`Solicitação para ${deviceName} (${deviceId}), #TASK-${taskNumber}.\n${await contextFor(deviceId)}\nPedido: ${request}\nUse deviceId "${deviceId}".\n${configurationPlanningInstruction(inferWorkType(request),taskNumber)}`);}catch(error){logger.error(`[cisco_ios] ${error.message}`);return{text:`❌ Erro ao diagnosticar ${deviceName}: ${error.message}`,toolsUsed:[]};}}
  async executeSolution(deviceId,deviceName,solution,taskNumber){try{const deviceContext=await contextFor(deviceId);return await withApprovedRemediation(()=>this.run(`Execute a mudança aprovada #TASK-${taskNumber} em ${deviceName} (${deviceId}).\n${deviceContext}\nSolução: ${solution}\nUse changeComment em toda alteração, valide e pare em caso de erro.`),{taskNumber,agentName:this.name,deviceId});}catch(error){return{text:`❌ Erro ao aplicar solução em ${deviceName}: ${error.message}`,toolsUsed:[]};}}
}

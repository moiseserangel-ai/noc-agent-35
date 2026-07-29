import BaseAgent from './base-agent.js';
import { sshEdgeOsExec, sshEdgeOsToolDefinition } from '../tools/ssh-ubiquiti-edgeos.tool.js';
import { pingHost, pingToolDefinition, tracerouteHost, tracerouteToolDefinition } from '../tools/network.tool.js';
import { getDeviceById } from '../services/device.service.js';
import { withApprovedRemediation } from '../security/execution-context.js';
import { configurationPlanningInstruction } from '../services/agent-approval-policy.service.js';
import { inferWorkType } from '../services/work-type.service.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT=`Você é especialista em Ubiquiti EdgeRouter e EdgeOS, atuando em um NOC.

Regras:
- Use somente sintaxe EdgeOS/Vyatta compatível com a versão cadastrada.
- Em diagnóstico use show, ping, traceroute e mtr.
- Toda alteração exige Task e aprovação humana.
- Antes de mudar, apresente evidências, aplicação, risco, rollback e validação.
- Para mudanças aprovadas use configure, o menor conjunto de set/delete, compare, commit e save apenas após validação.
- Nunca execute reboot, poweroff, factory reset ou manipulação de imagem.
- Preserve acesso de gestão e nunca remova a rota ou interface usada pela sessão sem plano de contingência.
- Informe changeComment em toda mudança; a tool adiciona description a interfaces compatíveis.

Consultas úteis:
show version
show system hardware
show interfaces
show interfaces ethernet
show ip route
show protocols bgp summary
show vpn ipsec status
show firewall
show configuration commands
show log

Em propostas finalize com "Responda com SIM para aplicar ou NÃO para cancelar." e mencione #TASK-{taskNumber}.`;

async function contextFor(deviceId){const device=await getDeviceById(deviceId);return device?`Fabricante: ${device.manufacturer||'Ubiquiti'}\nPlataforma: ${device.platform||'EdgeOS'}\nModelo: ${device.model||'não informado'}\nVersão: ${device.osVersion||'não informada'}\nCapacidades: ${device.capabilities||'não informadas'}`:'';}

export default class UbiquitiEdgeOsAgent extends BaseAgent{
  constructor(){super('ubiquiti_edgeos',SYSTEM_PROMPT);this.registerTool(sshEdgeOsToolDefinition,sshEdgeOsExec);this.registerTool(pingToolDefinition,pingHost);this.registerTool(tracerouteToolDefinition,tracerouteHost);}
  async diagnose(deviceId,deviceName,request,taskNumber){try{const planning=configurationPlanningInstruction(inferWorkType(request),taskNumber);return await this.run(`Solicitação NOC para ${deviceName} (ID: ${deviceId}), Task #TASK-${taskNumber}.\n${await contextFor(deviceId)}\nSolicitação: ${request}\nUse deviceId "${deviceId}".\n${planning}`);}catch(error){logger.error(`[ubiquiti_edgeos] Diagnosis error: ${error.message}`);return{text:`❌ Erro ao diagnosticar ${deviceName}: ${error.message}`,toolsUsed:[]};}}
  async executeSolution(deviceId,deviceName,solution,taskNumber){try{const deviceContext=await contextFor(deviceId);return await withApprovedRemediation(()=>this.run(`Execute a mudança aprovada da Task #TASK-${taskNumber} em ${deviceName} (ID: ${deviceId}).\n${deviceContext}\nSolução: ${solution}\nAplique somente o aprovado, compare, commit, valide e então save. Envie changeComment.`),{taskNumber,agentName:this.name,deviceId});}catch(error){logger.error(`[ubiquiti_edgeos] Execution error: ${error.message}`);return{text:`❌ Erro ao aplicar solução em ${deviceName}: ${error.message}`,toolsUsed:[]};}}
}

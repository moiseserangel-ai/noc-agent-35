import BaseAgent from './base-agent.js';
import { datacomToolDefinition, nokiaToolDefinition, sshDatacomDmosExec, sshNokiaSrosExec } from '../tools/ssh-profiled-network.tool.js';
import { withApprovedRemediation } from '../security/execution-context.js';
import { getDeviceById } from '../services/device.service.js';
import logger from '../utils/logger.js';

const definitions={
  datacom_dmos:{label:'Datacom DMOS',tool:datacomToolDefinition,exec:sshDatacomDmosExec,queries:'show version, show interfaces, show ip route, show lldp neighbors detail'},
  nokia_sros:{label:'Nokia SR OS',tool:nokiaToolDefinition,exec:sshNokiaSrosExec,queries:'show version, show chassis, show port, show router route-table, show system lldp neighbor'},
};

class ProfiledNetworkAgent extends BaseAgent{
  constructor(type){const d=definitions[type];super(type,`Você é especialista em ${d.label}. Responda em português brasileiro. Diagnóstico usa somente comandos show, ping e traceroute. Toda alteração exige Task e aprovação. Colete versão e modelo antes de escolher sintaxe. Apresente evidências, risco, aplicação, rollback e validação. Nunca execute reboot, erase, format, factory reset ou manipulação de software. Informe changeComment em toda mudança. Consultas úteis: ${d.queries}.`);this.definition=d;this.registerTool(d.tool,d.exec);}
  async diagnose(deviceId,deviceName,request,taskNumber){try{const device=await getDeviceById(deviceId);const context=device?`Hostname/IP: ${device.hostname||'não informado'} | Porta SSH: ${device.port||22} | Modelo: ${device.model||'não informado'} | Versão: ${device.osVersion||'não informada'}`:'Contexto cadastrado indisponível';return await this.run(`Diagnostique ${deviceName} (ID ${deviceId}) na Task #TASK-${taskNumber}. Contexto: ${context}. Solicitação: ${request}. Use deviceId "${deviceId}".`);}catch(error){logger.error(error.message);return{text:`❌ ${error.message}`,toolsUsed:[]};}}
  async executeSolution(deviceId,deviceName,solution,taskNumber){try{return await withApprovedRemediation(()=>this.run(`Execute a solução aprovada da Task #TASK-${taskNumber} em ${deviceName}, ID ${deviceId}: ${solution}. Valide e informe rollback; envie changeComment.`),{taskNumber,agentName:this.name,deviceId});}catch(error){return{text:`❌ ${error.message}`,toolsUsed:[]};}}
}
export class DatacomDmosAgent extends ProfiledNetworkAgent{constructor(){super('datacom_dmos');}}
export class NokiaSrosAgent extends ProfiledNetworkAgent{constructor(){super('nokia_sros');}}

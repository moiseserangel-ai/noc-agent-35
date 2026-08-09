import BaseAgent from './base-agent.js';
import { unifiControllerQuery, unifiControllerToolDefinition } from '../tools/unifi-controller.tool.js';
import logger from '../utils/logger.js';
import { getDeviceById } from '../services/device.service.js';

const SYSTEM_PROMPT=`Você é especialista em UniFi Network e UniFi OS, atuando em um NOC.
- Consulte somente pela tool UniFi, usando status, sites, devices, clients e alarms.
- Esta integração é somente leitura. Nunca afirme que aplicou configuração.
- Diferencie controlador, gateway, switch e access point.
- Correlacione estado, adoção, versão, uplink, clientes, alarmes e disponibilidade.
- Não exponha tokens, cookies, senhas ou configurações sensíveis.
- Se o usuário pedir mudança, apresente plano, risco e validação, informando que a execução pela API ainda requer homologação.`;

export default class UniFiControllerAgent extends BaseAgent{
  constructor(){super('unifi_controller',SYSTEM_PROMPT);this.registerTool(unifiControllerToolDefinition,unifiControllerQuery);}
  async diagnose(deviceId,deviceName,request,taskNumber){try{const device=await getDeviceById(deviceId);const context=device?`Hostname/IP: ${device.hostname||'não informado'} | Porta: ${device.port||443} | Modelo: ${device.model||'não informado'} | Versão: ${device.osVersion||'não informada'}`:'Contexto cadastrado indisponível';return await this.run(`Consulta UniFi para ${deviceName} (ID: ${deviceId}), Task #TASK-${taskNumber}. Contexto: ${context}. Solicitação: ${request}. Use deviceId "${deviceId}".`);}catch(error){logger.error(`[unifi_controller] ${error.message}`);return{text:`❌ Erro ao consultar ${deviceName}: ${error.message}`,toolsUsed:[]};}}
  async executeSolution(){return{text:'⛔ A integração UniFi está em modo somente leitura. A alteração deve ser planejada e homologada antes de habilitar escrita pela API.',toolsUsed:[]};}
}

import BaseAgent from './base-agent.js';
import { sshHuaweiVrpExec, sshHuaweiVrpToolDefinition } from '../tools/ssh-huawei-vrp.tool.js';
import { pingHost, pingToolDefinition, tracerouteHost, tracerouteToolDefinition } from '../tools/network.tool.js';
import { getDeviceById } from '../services/device.service.js';
import { withApprovedRemediation } from '../security/execution-context.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Você é especialista em Huawei VRP, com foco na família NetEngine 8000, atuando em um NOC.

Regras obrigatórias:
- Responda em português brasileiro e nunca misture sintaxe Cisco, Juniper ou MikroTik com Huawei VRP.
- Durante diagnóstico use exclusivamente comandos de leitura: display, ping e tracert.
- Antes de propor uma alteração, colete evidências e identifique versão VRP, modelo e contexto afetado quando forem relevantes.
- Toda alteração exige Task e aprovação humana. Nunca contorne a política da tool.
- Uma proposta de mudança deve apresentar: evidências, comandos de aplicação, risco, comandos de rollback e comandos de validação.
- Não presuma que commit é obrigatório: verifique a plataforma/versão e o modo de configuração.
- Comandos destrutivos como reboot, reset saved-configuration, format e troca de system-software são bloqueados.
- Para mudanças aprovadas, entre em system-view somente quando necessário, aplique o menor conjunto possível, valide e reporte cada resultado.
- Em toda chamada de alteração, envie changeComment curto e operacional. A tool aplica description nativa em interfaces, peers BGP e rotas estáticas compatíveis. Antes, consulte a configuração atual e, se já existir uma descrição importante, envie no próprio comando uma description que preserve o significado anterior; descriptions explícitas nunca são substituídas pela tool.
- Em caso de erro ou saída inesperada, pare; não tente comandos alternativos destrutivos.

Consultas úteis:
display version
display device
display interface brief
display interface <interface>
display ip routing-table
display bgp peer
display ospf peer brief
display isis peer
display mpls lsp
display alarm active
display logbuffer
display current-configuration

Quando houver proposta de alteração, finalize com: "Responda com SIM para aplicar ou NÃO para cancelar." e mencione #TASK-{taskNumber}.`;

const contextFor = async deviceId => {
  const device = await getDeviceById(deviceId);
  return device ? `Fabricante: ${device.manufacturer || 'Huawei'}\nPlataforma: ${device.platform || 'VRP'}\nModelo: ${device.model || 'não informado'}\nVersão: ${device.osVersion || 'não informada'}\nCapacidades: ${device.capabilities || 'não informadas'}` : '';
};

export default class HuaweiVrpAgent extends BaseAgent {
  constructor() {
    super('huawei_vrp', SYSTEM_PROMPT);
    this.registerTool(sshHuaweiVrpToolDefinition, sshHuaweiVrpExec);
    this.registerTool(pingToolDefinition, pingHost);
    this.registerTool(tracerouteToolDefinition, tracerouteHost);
  }

  async diagnose(deviceId, deviceName, request, taskNumber) {
    try {
      return await this.run(`Solicitação NOC para ${deviceName} (ID: ${deviceId}), Task #TASK-${taskNumber}.\n${await contextFor(deviceId)}\nSolicitação: ${request}\nUse o deviceId "${deviceId}" nas tools.`);
    } catch (error) {
      logger.error(`[huawei_vrp] Diagnosis error: ${error.message}`);
      return { text: `❌ Erro ao diagnosticar ${deviceName}: ${error.message}`, toolsUsed: [] };
    }
  }

  async executeSolution(deviceId, deviceName, solution, taskNumber) {
    try {
      const deviceContext = await contextFor(deviceId);
      return await withApprovedRemediation(() => this.run(`Execute a mudança já aprovada da Task #TASK-${taskNumber} em ${deviceName} (ID: ${deviceId}).\n${deviceContext}\nSolução aprovada: ${solution}\nAplique somente os comandos aprovados, valide o resultado e informe rollback se houver falha. Use deviceId "${deviceId}" e informe changeComment em toda alteração.`), { taskNumber, agentName: this.name, deviceId });
    } catch (error) {
      logger.error(`[huawei_vrp] Execution error: ${error.message}`);
      return { text: `❌ Erro ao aplicar solução em ${deviceName}: ${error.message}`, toolsUsed: [] };
    }
  }
}

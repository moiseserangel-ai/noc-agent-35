import BaseAgent from './base-agent.js';
import { sshJuniperJunosExec, sshJuniperJunosToolDefinition } from '../tools/ssh-juniper-junos.tool.js';
import { pingHost, pingToolDefinition, tracerouteHost, tracerouteToolDefinition } from '../tools/network.tool.js';
import { getDeviceById } from '../services/device.service.js';
import { withApprovedRemediation } from '../security/execution-context.js';
import { configurationPlanningInstruction } from '../services/agent-approval-policy.service.js';
import { inferWorkType } from '../services/work-type.service.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Você é especialista em Juniper Junos, incluindo as famílias MX, SRX, EX, QFX, ACX e PTX, atuando em um NOC.

Regras obrigatórias:
- Responda em português brasileiro e utilize somente sintaxe Junos compatível com o modelo e versão informados.
- Durante diagnóstico use show, ping, traceroute e monitor.
- Antes de alterar, colete evidências e apresente aplicação, risco, rollback e validação.
- Toda alteração exige Task e aprovação humana; nunca contorne a política da tool.
- Prefira comandos no formato set e use configure exclusive quando possível.
- Para reduzir risco, utilize commit check e commit confirmed antes da confirmação definitiva.
- Nunca execute reboot, halt, power-off, zeroize ou exclusão de configuração.
- Em toda alteração informe changeComment. A tool registra a mudança e adiciona annotate quando a hierarquia permitir.
- Se houver erro ou commit check falhar, pare e recomende rollback sem ações destrutivas automáticas.

Consultas úteis:
show version
show chassis hardware
show interfaces terse
show route summary
show bgp summary
show ospf neighbor
show isis adjacency
show lldp neighbors
show system alarms
show log messages
show configuration | display set

Em propostas de alteração, finalize com "Responda com SIM para aplicar ou NÃO para cancelar." e mencione #TASK-{taskNumber}.`;

async function contextFor(deviceId) {
  const device = await getDeviceById(deviceId);
  return device ? `Fabricante: ${device.manufacturer || 'Juniper'}\nPlataforma: ${device.platform || 'Junos'}\nModelo: ${device.model || 'não informado'}\nVersão: ${device.osVersion || 'não informada'}\nCapacidades: ${device.capabilities || 'não informadas'}` : '';
}

export default class JuniperJunosAgent extends BaseAgent {
  constructor() {
    super('juniper_junos', SYSTEM_PROMPT);
    this.registerTool(sshJuniperJunosToolDefinition, sshJuniperJunosExec);
    this.registerTool(pingToolDefinition, pingHost);
    this.registerTool(tracerouteToolDefinition, tracerouteHost);
  }

  async diagnose(deviceId, deviceName, request, taskNumber) {
    try {
      const planning = configurationPlanningInstruction(inferWorkType(request), taskNumber);
      return await this.run(`Solicitação NOC para ${deviceName} (ID: ${deviceId}), Task #TASK-${taskNumber}.\n${await contextFor(deviceId)}\nSolicitação: ${request}\nUse deviceId "${deviceId}" nas tools.\n${planning}`);
    } catch (error) {
      logger.error(`[juniper_junos] Diagnosis error: ${error.message}`);
      return { text: `❌ Erro ao diagnosticar ${deviceName}: ${error.message}`, toolsUsed: [] };
    }
  }

  async executeSolution(deviceId, deviceName, solution, taskNumber) {
    try {
      const deviceContext = await contextFor(deviceId);
      return await withApprovedRemediation(
        () => this.run(`Execute a mudança aprovada da Task #TASK-${taskNumber} em ${deviceName} (ID: ${deviceId}).\n${deviceContext}\nSolução: ${solution}\nUse configure exclusive, commit check, commit confirmed, valide e somente então confirme o commit. Informe changeComment em toda alteração.`),
        { taskNumber, agentName: this.name, deviceId },
      );
    } catch (error) {
      logger.error(`[juniper_junos] Execution error: ${error.message}`);
      return { text: `❌ Erro ao aplicar solução em ${deviceName}: ${error.message}`, toolsUsed: [] };
    }
  }
}

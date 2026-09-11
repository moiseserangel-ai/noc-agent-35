import BaseAgent from './base-agent.js';
import { sshFortiGateExec, sshFortiGateToolDefinition } from '../tools/ssh-fortigate-fortios.tool.js';
import { pingHost, pingToolDefinition, tracerouteHost, tracerouteToolDefinition } from '../tools/network.tool.js';
import { getDeviceById } from '../services/device.service.js';
import { withApprovedRemediation } from '../security/execution-context.js';
import { configurationPlanningInstruction } from '../services/agent-approval-policy.service.js';
import { inferWorkType } from '../services/work-type.service.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Você é especialista em Fortinet FortiGate e FortiOS, atuando em um NOC.

Regras:
- Responda em português brasileiro e não misture sintaxe de outros fabricantes.
- Em diagnóstico use get, show, diagnose, execute ping e execute traceroute.
- Considere VDOM, HA, versão FortiOS, interfaces, zonas, políticas, rotas e VPNs antes de propor mudança.
- Toda alteração exige Task e aprovação humana.
- Apresente evidências, impacto, aplicação, rollback e validação.
- Nunca execute reboot, shutdown, factoryreset, formatação, restore ou purge.
- Faça mudanças mínimas e valide com diagnose debug flow somente quando necessário, limitando e encerrando o debug.
- Em políticas, preserve comentários existentes importantes; informe changeComment em toda alteração.
- Nunca desabilite política ou acesso administrativo sem confirmar caminho alternativo.

Consultas úteis:
get system status
get system performance status
get system ha status
get router info routing-table all
get router info bgp summary
show system interface
show firewall policy
show vpn ipsec phase1-interface
diagnose hardware deviceinfo nic
diagnose sys session stat
diagnose vpn tunnel list

Em propostas, finalize com "Responda com SIM para aplicar ou NÃO para cancelar." e mencione #TASK-{taskNumber}.`;

async function contextFor(deviceId) {
  const device = await getDeviceById(deviceId);
  return device ? `Fabricante: ${device.manufacturer || 'Fortinet'}\nPlataforma: ${device.platform || 'FortiOS'}\nModelo: ${device.model || 'não informado'}\nVersão: ${device.osVersion || 'não informada'}\nCapacidades: ${device.capabilities || 'não informadas'}` : '';
}

export default class FortiGateFortiOsAgent extends BaseAgent {
  constructor() {
    super('fortigate_fortios', SYSTEM_PROMPT);
    this.registerTool(sshFortiGateToolDefinition, sshFortiGateExec);
    this.registerTool(pingToolDefinition, pingHost);
    this.registerTool(tracerouteToolDefinition, tracerouteHost);
  }

  async diagnose(deviceId, deviceName, request, taskNumber) {
    try {
      const planning = configurationPlanningInstruction(inferWorkType(request), taskNumber);
      return await this.run(`Solicitação NOC para ${deviceName} (ID: ${deviceId}), Task #TASK-${taskNumber}.\n${await contextFor(deviceId)}\nSolicitação: ${request}\nUse deviceId "${deviceId}".\n${planning}`);
    } catch (error) {
      logger.error(`[fortigate_fortios] Diagnosis error: ${error.message}`);
      return { text:`❌ Erro ao diagnosticar ${deviceName}: ${error.message}`, toolsUsed:[] };
    }
  }

  async executeSolution(deviceId, deviceName, solution, taskNumber) {
    try {
      const deviceContext = await contextFor(deviceId);
      return await withApprovedRemediation(
        () => this.run(`Execute a mudança aprovada da Task #TASK-${taskNumber} em ${deviceName} (ID: ${deviceId}).\n${deviceContext}\nSolução: ${solution}\nAplique somente o aprovado, valide e informe rollback. Envie changeComment em toda alteração.`),
        { taskNumber, agentName:this.name, deviceId },
      );
    } catch (error) {
      logger.error(`[fortigate_fortios] Execution error: ${error.message}`);
      return { text:`❌ Erro ao aplicar solução em ${deviceName}: ${error.message}`, toolsUsed:[] };
    }
  }
}

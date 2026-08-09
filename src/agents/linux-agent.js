import BaseAgent from './base-agent.js';
import { sshLinuxExec, sshLinuxToolDefinition } from '../tools/ssh-linux.tool.js';
import { pingHost, pingToolDefinition, tracerouteHost, tracerouteToolDefinition } from '../tools/network.tool.js';
import logger from '../utils/logger.js';
import { withApprovedRemediation } from '../security/execution-context.js';
import { configurationPlanningInstruction } from '../services/agent-approval-policy.service.js';
import { inferWorkType } from '../services/work-type.service.js';
import { getDeviceById } from '../services/device.service.js';

const SYSTEM_PROMPT = `Você é um especialista em Linux/Servidores para um NOC (Network Operations Center).

## Sua função:
1. Acessar servidores Linux via SSH usando as tools disponíveis
2. Executar comandos de diagnóstico de forma metódica
3. Analisar resultados e identificar problemas
4. Propor soluções específicas com comandos Linux

## Comandos úteis para diagnóstico:
- uptime - Uptime e load average
- free -m - Memória disponível
- df -h - Espaço em disco
- top -bn1 | head -20 - Processos consumindo mais recursos
- systemctl list-units --failed - Serviços com falha
- systemctl status <service> - Status de um serviço
- journalctl -u <service> --no-pager -n 50 - Logs de um serviço
- netstat -tlnp ou ss -tlnp - Portas em escuta
- ip addr show - Interfaces de rede
- ip route show - Tabela de rotas
- ping -c 4 <target> - Teste de conectividade
- cat /var/log/syslog | tail -50 - Últimos logs do sistema
- dmesg | tail -20 - Mensagens do kernel

## Regras de Comportamento:
- Aja de forma autônoma e natural. Converse diretamente com o usuário sem formatos engessados.
- Atenda EXATAMENTE ao que foi solicitado. Se o usuário pedir apenas uma informação simples, acesse o servidor, pegue a informação e responda diretamente. Não faça diagnósticos não solicitados.
- Durante diagnóstico execute somente comandos de leitura. Nunca altere configuração, instale pacotes ou reinicie serviços. Toda mudança exige aprovação humana registrada.
- Em toda chamada de alteração, envie changeComment com um resumo objetivo. O sistema gravará esse comentário no syslog do servidor e no histórico da Task.
- Em casos de pedidos genéricos de problema (ex: "analise por que o servidor está caindo"), aí sim aja como investigador: verifique load, memória, disco, logs de erro, etc.
- Responda SEMPRE em português brasileiro.
- Caso precise de confirmação para aplicar algo, termine a mensagem com "Responda com SIM para aplicar ou NÃO para cancelar." e mencione a ref: #TASK-{taskNumber} (se houver).
---`;

const contextFor = async deviceId => { const device = await getDeviceById(deviceId); return device ? `Hostname/IP: ${device.hostname || 'não informado'} | Porta SSH: ${device.port || 22} | Plataforma: ${device.platform || 'Linux'} | Modelo: ${device.model || 'não informado'} | Versão: ${device.osVersion || 'não informada'}` : 'Contexto cadastrado indisponível'; };

export default class LinuxAgent extends BaseAgent {
  constructor() {
    super('linux', SYSTEM_PROMPT);

    this.registerTool(sshLinuxToolDefinition, sshLinuxExec);
    this.registerTool(pingToolDefinition, pingHost);
    this.registerTool(tracerouteToolDefinition, tracerouteHost);
  }

  async diagnose(deviceId, deviceName, request, taskNumber) {
    const deviceContext = await contextFor(deviceId);
    const planningInstruction = configurationPlanningInstruction(inferWorkType(request), taskNumber);
    const prompt = `Você recebeu uma solicitação do NOC.

**Servidor:** ${deviceName} (ID: ${deviceId})
**Tipo:** Linux
**Contexto cadastrado:** ${deviceContext}
**Task:** #TASK-${taskNumber}
**Solicitação:** ${request}
Acesse o servidor, analise e atenda à solicitação da forma mais autônoma possível. Use o deviceId "${deviceId}" em todas as chamadas de tools.
${planningInstruction}`;

    try {
      const result = await this.run(prompt);
      logger.info(`[linux] Diagnosis completed for ${deviceName} (#TASK-${taskNumber})`);
      return result;
    } catch (err) {
      logger.error(`[linux] Diagnosis error: ${err.message}`);
      return {
        text: `❌ Erro ao diagnosticar ${deviceName}: ${err.message}`,
        toolsUsed: [],
      };
    }
  }

  async executeSolution(deviceId, deviceName, solution, taskNumber) {
    const prompt = `Execute a seguinte solução aprovada pelo administrador:

**Servidor:** ${deviceName} (ID: ${deviceId})
**Task:** #TASK-${taskNumber}
**Solução a aplicar:** ${solution}

Execute os comandos necessários e reporte o resultado. Use o deviceId "${deviceId}".
Confirme se a solução foi aplicada com sucesso ou se houve algum erro.`;

    try {
      const result = await withApprovedRemediation(() => this.run(prompt), { taskNumber, agentName: this.name, deviceId });
      logger.info(`[linux] Solution executed for ${deviceName} (#TASK-${taskNumber})`);
      return result;
    } catch (err) {
      logger.error(`[linux] Solution execution error: ${err.message}`);
      return {
        text: `❌ Erro ao aplicar solução em ${deviceName}: ${err.message}`,
        toolsUsed: [],
      };
    }
  }
}

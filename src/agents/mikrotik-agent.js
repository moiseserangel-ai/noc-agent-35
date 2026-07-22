import BaseAgent from './base-agent.js';
import { sshMikrotikExec, sshMikrotikToolDefinition } from '../tools/ssh-mikrotik.tool.js';
import { pingHost, pingToolDefinition, tracerouteHost, tracerouteToolDefinition } from '../tools/network.tool.js';
import logger from '../utils/logger.js';
import { withApprovedRemediation } from '../security/execution-context.js';

const SYSTEM_PROMPT = `Você é um especialista em MikroTik RouterOS para um NOC (Network Operations Center).

## Sua função:
1. Acessar equipamentos MikroTik via SSH usando as tools disponíveis
2. Executar comandos de diagnóstico de forma metódica
3. Analisar resultados e identificar problemas
4. Propor soluções específicas com comandos RouterOS

## Comandos úteis para diagnóstico:
- /system resource print - CPU, memória, uptime
- /interface print - Status das interfaces
- /interface ethernet print - Detalhes das interfaces ethernet
- /ip address print - Endereços IP configurados
- /ip route print - Tabela de rotas
- /ping <target> count=5 - Teste de conectividade
- /log print last=20 - Últimos logs
- /queue simple print - Filas de QoS
- /ip firewall filter print - Regras de firewall
- /system routerboard print - Info do hardware
- /ip dns print - Configuração DNS

## Regras de Comportamento:
- Aja de forma autônoma e natural. Converse diretamente com o usuário sem formatos engessados.
- Atenda EXATAMENTE ao que foi solicitado. Se o usuário pedir apenas uma informação simples (ex: "me dê os IPs"), apenas acesse o equipamento, obtenha os IPs e responda. Não faça diagnósticos extras que não foram solicitados.
- Durante diagnóstico execute somente comandos de leitura. Nunca altere a configuração. Toda mudança exige aprovação humana registrada.
- Em toda chamada de alteração, envie o campo changeComment descrevendo objetivamente o que foi feito. Quando o item RouterOS aceitar comment, preserve comentários existentes relevantes e inclua a referência da Task.
- Em casos de pedidos genéricos de problema (ex: "analise por que está lento"), aí sim aja como um investigador: verifique CPU, memória, interfaces, logs, etc.
- Responda SEMPRE em português brasileiro.
- Caso precise de confirmação para aplicar algo, termine a mensagem com "Responda com SIM para aplicar ou NÃO para cancelar." e mencione a ref: #TASK-{taskNumber} (se houver).
---`;

export default class MikrotikAgent extends BaseAgent {
  constructor() {
    super('mikrotik', SYSTEM_PROMPT);

    this.registerTool(sshMikrotikToolDefinition, sshMikrotikExec);
    this.registerTool(pingToolDefinition, pingHost);
    this.registerTool(tracerouteToolDefinition, tracerouteHost);
  }

  async diagnose(deviceId, deviceName, request, taskNumber) {
    const prompt = `Você recebeu uma solicitação do NOC.

**Dispositivo:** ${deviceName} (ID: ${deviceId})
**Tipo:** MikroTik RouterOS
**Task:** #TASK-${taskNumber}
**Solicitação:** ${request}
Acesse o equipamento, analise e atenda à solicitação da forma mais autônoma possível. Use o deviceId "${deviceId}" em todas as chamadas de tools.`;

    try {
      const result = await this.run(prompt);
      logger.info(`[mikrotik] Diagnosis completed for ${deviceName} (#TASK-${taskNumber})`);
      return result;
    } catch (err) {
      logger.error(`[mikrotik] Diagnosis error: ${err.message}`);
      return {
        text: `❌ Erro ao diagnosticar ${deviceName}: ${err.message}`,
        toolsUsed: [],
      };
    }
  }

  async executeSolution(deviceId, deviceName, solution, taskNumber) {
    const prompt = `Execute a seguinte solução aprovada pelo administrador:

**Dispositivo:** ${deviceName} (ID: ${deviceId})
**Task:** #TASK-${taskNumber}
**Solução a aplicar:** ${solution}

Execute os comandos necessários e reporte o resultado. Use o deviceId "${deviceId}".
Confirme se a solução foi aplicada com sucesso ou se houve algum erro.`;

    try {
      const result = await withApprovedRemediation(() => this.run(prompt), { taskNumber, agentName: this.name, deviceId });
      logger.info(`[mikrotik] Solution executed for ${deviceName} (#TASK-${taskNumber})`);
      return result;
    } catch (err) {
      logger.error(`[mikrotik] Solution execution error: ${err.message}`);
      return {
        text: `❌ Erro ao aplicar solução em ${deviceName}: ${err.message}`,
        toolsUsed: [],
      };
    }
  }
}

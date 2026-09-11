const variable=(key,label,pattern,defaultValue='')=>({key,label,required:true,default:defaultValue,pattern});
const step=(name,command,validation='',rollback='')=>({name,deviceType:'any',command,validation,rollback,continueOnError:false});

const templates=[
  {
    key:'mikrotik-interface-diagnostic',name:'MikroTik · Diagnóstico de interface',category:'diagnostic',deviceType:'mikrotik',
    description:'Consulta detalhes, tráfego e erros de uma interface RouterOS sem realizar alterações.',
    variables:[variable('interface','Interface','^[A-Za-z0-9_.-]+$','ether1')],
    steps:[step('Estado e configuração','/interface print detail where name={{interface}}'),step('Monitoramento de tráfego','/interface monitor-traffic {{interface}} once')],
  },
  {
    key:'mikrotik-routing-diagnostic',name:'MikroTik · Diagnóstico de roteamento',category:'network',deviceType:'mikrotik',
    description:'Coleta rotas, vizinhança ARP e teste de alcance no RouterOS.',
    variables:[variable('target','Destino IPv4','^(?:\\d{1,3}\\.){3}\\d{1,3}$','8.8.8.8')],
    steps:[step('Tabela de rotas','/ip route print detail'),step('Vizinhança IP','/ip arp print detail'),step('Teste de alcance','/ping address={{target}} count=5')],
  },
  {
    key:'huawei-interface-diagnostic',name:'Huawei VRP · Diagnóstico de interface',category:'diagnostic',deviceType:'huawei_vrp',
    description:'Consulta estado, descrição, contadores e erros de uma interface Huawei VRP.',
    variables:[variable('interface','Interface','^[A-Za-z][A-Za-z0-9/.-]+$','GigabitEthernet0/0/1')],
    steps:[step('Resumo das interfaces','display interface brief'),step('Detalhes da interface','display interface {{interface}}')],
  },
  {
    key:'cisco-interface-diagnostic',name:'Cisco IOS · Diagnóstico de interface',category:'diagnostic',deviceType:'cisco_ios',
    description:'Coleta estado operacional, contadores e configuração da interface Cisco IOS.',
    variables:[variable('interface','Interface','^[A-Za-z][A-Za-z0-9/.-]+$','GigabitEthernet0/1')],
    steps:[step('Resumo das interfaces','show ip interface brief'),step('Detalhes da interface','show interfaces {{interface}}'),step('Configuração aplicada','show running-config interface {{interface}}')],
  },
  {
    key:'juniper-interface-diagnostic',name:'Juniper Junos · Diagnóstico de interface',category:'diagnostic',deviceType:'juniper_junos',
    description:'Consulta estado resumido e informações extensas de uma interface Juniper Junos.',
    variables:[variable('interface','Interface','^[A-Za-z][A-Za-z0-9/.-]+$','ge-0/0/0')],
    steps:[step('Resumo das interfaces','show interfaces terse'),step('Detalhes da interface','show interfaces {{interface}} extensive')],
  },
  {
    key:'fortigate-health-diagnostic',name:'FortiGate · Saúde e roteamento',category:'security',deviceType:'fortigate_fortios',
    description:'Coleta estado do appliance, interfaces e tabela de roteamento FortiOS.',
    variables:[],steps:[step('Estado do sistema','get system status'),step('Interfaces','get system interface physical'),step('Tabela de roteamento','get router info routing-table all')],
  },
  {
    key:'edgeos-network-diagnostic',name:'EdgeOS · Diagnóstico de rede',category:'diagnostic',deviceType:'ubiquiti_edgeos',
    description:'Consulta interfaces, rotas e conectividade em equipamentos Ubiquiti EdgeOS.',
    variables:[variable('target','Destino IPv4','^(?:\\d{1,3}\\.){3}\\d{1,3}$','8.8.8.8')],
    steps:[step('Interfaces','show interfaces'),step('Rotas','show ip route'),step('Teste de alcance','ping {{target}} count 5')],
  },
  {
    key:'datacom-network-diagnostic',name:'Datacom DMOS · Diagnóstico de rede',category:'diagnostic',deviceType:'datacom_dmos',
    description:'Coleta estado das interfaces, VLANs e rotas em equipamentos Datacom DMOS.',
    variables:[],steps:[step('Interfaces','show interfaces status'),step('VLANs','show vlan'),step('Rotas','show ip route')],
  },
  {
    key:'nokia-network-diagnostic',name:'Nokia SR OS · Diagnóstico de rede',category:'diagnostic',deviceType:'nokia_sros',
    description:'Coleta portas, interfaces de roteamento e rotas em equipamentos Nokia SR OS.',
    variables:[],steps:[step('Portas','show port'),step('Interfaces','show router interface'),step('Rotas','show router route-table')],
  },
  {
    key:'linux-service-diagnostic',name:'Linux · Diagnóstico de serviço',category:'monitoring',deviceType:'linux',
    description:'Verifica estado, processos, portas e logs recentes de um serviço Linux.',
    variables:[variable('service','Serviço systemd','^[A-Za-z0-9@_.-]+$','nginx')],
    steps:[step('Estado do serviço','systemctl status {{service}}'),step('Processos','ps aux'),step('Portas em escuta','ss -lntup'),step('Logs recentes','journalctl -u {{service}} -n 100 --no-pager')],
  },
];

export const listRunbookTemplates=()=>templates.map(item=>({...item,variables:item.variables.map(v=>({...v})),steps:item.steps.map(s=>({...s}))}));
export const getRunbookTemplate=key=>listRunbookTemplates().find(item=>item.key===key)||null;

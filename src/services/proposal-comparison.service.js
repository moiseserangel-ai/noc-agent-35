const SECRET=/\b(?:password|passwd|secret|community|token|api[_ -]?key|private-key|pre-shared-key|preshared-key)\s*[=: ]\s*\S+/gi;
const CHANGE=/^(?:\/(?:[\w-]+\s+)*(?:add|set|remove|delete|disable|enable|move|unset|reset)\b|(?:add|set|remove|delete|disable|enable|move|unset|reset|interface|ip\s|ipv6\s|router\s|route\s|firewall\s|vlan\s|undo\s|no\s|shutdown\s|system-view\b|configure\b|description\s|traffic-policy\s|port\s))/i;
const DESTRUCTIVE=/\b(?:remove|delete|disable|unset|reset|undo|no\s|shutdown|drop)\b/i;

const clean=line=>String(line||'').replace(SECRET,match=>`${match.split(/[=: ]/)[0]}=[PROTEGIDO]`).trim();
const normalized=line=>clean(line).toLowerCase().replace(/^\[[^\]]+\]\s*/,'').replace(/^\/[\w-]+(?:\s+[\w-]+)*\s+(?=add|set|remove|disable|enable)/,'').replace(/\s+/g,' ').trim();

export function extractProposedCommands(text=''){
  const source=String(text),blocks=[...source.matchAll(/```(?:\w+)?\s*\n([\s\S]*?)```/g)].map(match=>match[1]);
  const candidates=(blocks.length?blocks:[source]).flatMap(block=>block.split('\n')).map(line=>line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()).filter(line=>line&&!/^\s*(?:#|\/\*|;|observa|valida|rollback|risco|impacto|diagn[oó]st|plano|comandos?)\b/i.test(line));
  return [...new Set(candidates.filter(line=>CHANGE.test(line)).map(clean))].slice(0,200);
}

export function compareProposalWithConfiguration(configuration,proposal){
  const baseline=String(configuration||'').split('\n').map(clean).filter(Boolean),normalizedBaseline=baseline.map(line=>({raw:line,norm:normalized(line)}));
  const commands=extractProposedCommands(proposal);
  const rows=commands.map(command=>{
    const norm=normalized(command),tokens=norm.split(' ').filter(token=>token.length>2&&!/^(?:add|set|enable)$/.test(token));
    const matches=normalizedBaseline.filter(item=>item.norm===norm||(tokens.length>=2&&tokens.filter(token=>item.norm.includes(token)).length/Math.min(tokens.length,6)>=.75)).slice(0,5).map(item=>item.raw);
    const destructive=DESTRUCTIVE.test(norm);
    return{command,status:matches.length?'present':destructive?'removal':'change',risk:destructive,matches};
  });
  return{rows,summary:{commands:rows.length,present:rows.filter(row=>row.status==='present').length,changes:rows.filter(row=>row.status==='change').length,removals:rows.filter(row=>row.status==='removal').length,review:commands.length?0:1},warnings:[...(commands.length?[]:['Nenhum comando reconhecível foi encontrado na proposta. Revise o plano manualmente.']),...(rows.some(row=>row.risk)?['A proposta contém comandos destrutivos, de remoção ou regras de bloqueio. Confirme objetos e dependências antes da aprovação.']:[])]};
}

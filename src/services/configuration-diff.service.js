export function compareConfigurations(before,after){
  const stableLines=value=>String(value).split(/\r?\n/).filter(line=>!/^#\s+[a-z]{3}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\s+by RouterOS\b/i.test(line.trim()));
  const a=stableLines(before),b=stableLines(after),aSet=new Set(a),bSet=new Set(b),removed=a.filter(line=>line.trim()&&!bSet.has(line)),added=b.filter(line=>line.trim()&&!aSet.has(line));
  return{added:added.slice(0,2000),removed:removed.slice(0,2000),addedCount:added.length,removedCount:removed.length,unchangedCount:b.filter(line=>aSet.has(line)).length};
}

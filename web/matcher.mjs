import * as OpenCC from 'opencc-js';
const convert = OpenCC.Converter({from:'t', to:'cn'});
export const text = v => v == null ? '' : String(v).trim();
export const norm = v => convert(text(v).normalize('NFKC').replace(/[–—−]/g,'-')).toLowerCase().replace(/\s+/g,'');
export const firstText = v => text(v).split(/[\r\n;；、]+/).find(s=>s.trim())?.trim() || '';
const available = v => !['','-','n/a','na','none','无','未知'].includes(norm(v));
function orderNumber(v){
  v=firstText(v).normalize('NFKC').toUpperCase();
  return v.match(/(?<![A-Z0-9])(?:[A-Z]\d{3}-\d{6,12}|\d{9})(?![A-Z0-9])/i)?.[0] || (/^[A-Z]{2,}[-_]?[0-9]+$/.test(v)?v:'');
}
export function role(v){
  const h=norm(v);
  if(['ic','机型','ic型号','ic厂商','ic品牌'].includes(h))return 'ic';
  if(['机种','platform','产品名称','产品名','model','机种名称'].includes(h))return 'model';
  if(['dpn','客户品号','客户料号','客户pn','customerp/n'].includes(h))return 'dpn';
  if(h.includes('工单')||['客户订单号','工令号','workorder','workorderno'].includes(h))return 'order';
  if(h.includes('料号')||['产品料号','产品品号','品号','p/n','pn','miyabiexternalp/n','miyabiinternalp/n','partnumber'].includes(h))return 'part';
  if(['查询值','查找值','关键字','关键词','key','query'].includes(h))return 'any';
  return null;
}
export class Matcher {
  constructor(data){
    this.data=data;this.records=new Map(data.records.map(r=>[r.id,r]));this.keys=new Map();
    for(const [kind,value,id] of data.keys){for(const k of [kind+'\0'+value,'any\0'+value]){if(!this.keys.has(k))this.keys.set(k,new Set());this.keys.get(k).add(id);}}
  }
  ids(kind,value){return this.keys.get(kind+'\0'+norm(value))||new Set();}
  source(r){return {'檔案':r.source_file,'分頁':r.sheet,'列號':r.row_number,'原始IC／機型':r.raw_ic,'整理依據':r.resolution};}
  lookup(criteria){
    const sets=[],all=new Map(),evidence=new Map(),resolved=[];
    for(let [kind,value] of criteria){
      value=firstText(value);if(['order','any'].includes(kind))value=orderNumber(value)||value;
      if(!norm(value))continue;
      const ids=this.ids(kind,value),linked=new Set(ids);
      for(const id of ids){const r=this.records.get(id);if(r.model)continue;
        const primary=r.parts.filter(p=>p.startsWith('98'));const secondary=r.parts.filter(p=>p.startsWith('95'));
        const anchors=primary.length?primary:secondary.length?secondary:r.parts;
        for(const [k,v] of [...anchors.map(p=>['part',p]),...r.dpns.map(p=>['dpn',p])]){
          for(const other of this.ids(k,v)){if(!r.ic||norm(this.records.get(other).ic)===norm(r.ic))linked.add(other);}
        }
      }
      let pairs=new Set();
      for(const id of [...linked].sort((a,b)=>a-b)){
        const r=this.records.get(id),pair=JSON.stringify([norm(r.model),norm(r.ic)]);pairs.add(pair);
        if(!all.has(pair))all.set(pair,{'機種':r.model,IC:r.ic,'產品系列':new Set(),'來源':new Map()});
        const c=all.get(pair);if(r.family)c['產品系列'].add(r.family);c['來源'].set(id,this.source(r));
      }
      if([...pairs].some(p=>JSON.parse(p)[1]))pairs=new Set([...pairs].filter(p=>JSON.parse(p)[1]));
      sets.push(pairs);resolved.push({'欄位類別':kind,'查找值':value,'找到候選組數':pairs.size});
      for(const id of [...ids].sort((a,b)=>a-b)){const r=this.records.get(id);evidence.set(id,{'檔案':r.source_file,'分頁':r.sheet,'列號':r.row_number});}
    }
    const intersection=sets.length?[...sets[0]].filter(p=>sets.every(s=>s.has(p))):[];
    intersection.sort((a,b)=>{const x=JSON.parse(a),y=JSON.parse(b);return x[0]<y[0]?-1:x[0]>y[0]?1:x[1]<y[1]?-1:x[1]>y[1]?1:0;});
    const candidates=intersection.map(p=>{const c=all.get(p);return {'機種':c['機種'],IC:c.IC,'產品系列':[...c['產品系列']].sort(),'來源':[...c['來源'].values()]};});
    const status=!sets.length?'缺少查找欄位':!intersection.length?(sets.length>1&&sets.some(s=>s.size)?'條件不一致':'查無資料'):candidates.length>1?'多組候選':!available(candidates[0].IC)||!available(candidates[0]['機種'])?'來源未提供完整對應':'唯一匹配';
    return {'狀態':status,'候選':candidates,'查找條件':resolved,'查找依據':[...evidence.values()]};
  }
  search(q){return this.data.records.filter(r=>r.search_text.includes(norm(q))).slice(0,100);}
}
export function matchTables(matcher,tables,filename){
  const results=[],notices=[],lookups=new Map();
  for(const {name,raw,expanded} of tables){
    let header=null;
    for(let i=0;i<Math.min(raw.length,50);i++){const roles=(raw[i]||[]).map(role),score=roles.filter(Boolean).length;if(score&&(!header||score>header.score))header={score,offset:i,headers:raw[i]||[],roles};}
    if(!header){notices.push(`「${name}」沒有可辨識的查找欄位；請使用工單號、料號、DPN、機種、IC／機型或查詢值。`);continue;}
    for(let i=header.offset+1;i<raw.length;i++){
      if(!(raw[i]||[]).some(Boolean))continue;
      const criteria=header.roles.flatMap((r,c)=>r&&expanded[i][c]?[[r,expanded[i][c]]]:[]),key=JSON.stringify(criteria);if(!lookups.has(key))lookups.set(key,matcher.lookup(criteria));const result=lookups.get(key);
      const unique=result['狀態']==='唯一匹配'?result['候選'][0]:{};
      results.push({'分頁':name,'列號':i+1,'原始資料':[...new Set([...Object.keys(header.headers),...Object.keys(raw[i])])].map(Number).sort((a,b)=>a-b).map(c=>({'欄位':header.headers[c]||'','值':raw[i][c]||''})),'機種':unique['機種']||'',IC:unique.IC||'',...result});
    }
  }
  return {'檔名':filename,'筆數':results.length,'提示':notices,'結果':results};
}

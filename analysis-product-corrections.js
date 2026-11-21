(function(root){
const norm=value=>String(value??'').trim().normalize('NFKC').replace(/[–—−]/g,'-').toLowerCase().replace(/\s+/g,'');
const correctionOrder=value=>{const first=String(value??'').trim().split(/[\r\n;；、]+/)[0].normalize('NFKC').toUpperCase();return first.match(/(?<![A-Z0-9])(?:[A-Z]\d{3}-\d{6,12}|\d{9})(?![A-Z0-9])/i)?.[0]||first;};

// Resolve old Detail/index rows from explicitly confirmed order/part mappings.
// Keep complete identities and contradictory partial identities for manual review.
function applyConfirmedProductCorrections(merger,corrections=[],applied){
 const mappings=new Map(corrections.filter(row=>row.order&&row.ic&&row.model).map(row=>[
  JSON.stringify([norm(correctionOrder(row.order)),norm(row.part||'')]),row
 ]));
 let updated=0;
 for(const value of merger.rows.values()){
  const row=value.row,ic=String(row[9]??'').trim(),model=String(row[10]??'').trim();
  const order=norm(correctionOrder(row[1]));if(!order)continue;
  const general=mappings.get(JSON.stringify([order,'']));
  const saved=mappings.get(JSON.stringify([order,norm(row[2])]))||(general?.override?general:null);
  if(!saved)continue;
  if(!saved.override&&((ic&&model)||(ic&&norm(ic)!==norm(saved.ic))||(model&&norm(model)!==norm(saved.model))))continue;
  row[9]=saved.ic;row[10]=saved.model;if(saved.override)applied?.add(saved);updated++;
 }
 return updated;
}

async function resolveConfirmedProducts(merger,applied){
 if(!root.indexedDB)return 0;
 const state=await root.readBrowserDatabase();
 return applyConfirmedProductCorrections(merger,state?.reference?.manual_corrections||[],applied);
}

root.applyConfirmedProductCorrections=applyConfirmedProductCorrections;
root.resolveConfirmedProducts=resolveConfirmedProducts;
})(globalThis);

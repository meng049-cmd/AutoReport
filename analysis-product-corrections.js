(function(root){
const norm=value=>String(value??'').trim().normalize('NFKC').replace(/[–—−]/g,'-').toLowerCase().replace(/\s+/g,'');
const correctionOrder=value=>{const first=String(value??'').trim().split(/[\r\n;；、]+/)[0].normalize('NFKC').toUpperCase();return first.match(/(?<![A-Z0-9])(?:[A-Z]\d{3}-\d{6,12}|\d{9})(?![A-Z0-9])/i)?.[0]||first;};

// Resolve old Detail/index rows from explicitly confirmed order/part mappings.
// Keep complete identities and contradictory partial identities for manual review.
function applyConfirmedProductCorrections(merger,corrections=[]){
 const mappings=new Map(corrections.filter(row=>row.order&&row.ic&&row.model).map(row=>[
  JSON.stringify([norm(correctionOrder(row.order)),norm(row.part||'')]),row
 ]));
 let updated=0;
 for(const value of merger.rows.values()){
  const row=value.row,ic=String(row[9]??'').trim(),model=String(row[10]??'').trim();
  if(ic&&model)continue;
  const order=correctionOrder(row[1]);if(!order)continue;
  const saved=mappings.get(JSON.stringify([norm(order),norm(row[2])]));
  if(!saved||(ic&&norm(ic)!==norm(saved.ic))||(model&&norm(model)!==norm(saved.model)))continue;
  row[9]=saved.ic;row[10]=saved.model;updated++;
 }
 return updated;
}

async function resolveConfirmedProducts(merger){
 if(!root.indexedDB)return 0;
 const state=await root.readBrowserDatabase();
 return applyConfirmedProductCorrections(merger,state?.reference?.manual_corrections||[]);
}

root.applyConfirmedProductCorrections=applyConfirmedProductCorrections;
root.resolveConfirmedProducts=resolveConfirmedProducts;
})(globalThis);

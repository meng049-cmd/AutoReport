export function mountTrendOrderDetail(host, period, lines, load) {
 host.replaceChildren();
 if (!lines.length) return () => {};

 const details = document.createElement('details');
 const summary = document.createElement('summary');
 summary.textContent = '工單明細 · ' + period;
 const label = document.createElement('label');
 const select = document.createElement('select');
 label.append('製程／不良項目 ',select);
 for (const [index,line] of lines.entries()) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = line.defect;
  select.append(option);
 }
 const note = document.createElement('p');
 note.className = 'muted';
 note.textContent = '每片 PPID 依曲線採用的過站紀錄歸屬到一張工單。工單不良率為該項不良 PPID ÷ 該工單投入 PPID。';
 const status = document.createElement('p');
 status.setAttribute('role','status');
 const content = document.createElement('div');
 content.className = 'scroll';
 details.className = 'formula-notes';
 details.append(summary,label,note,status,content);
 host.append(details);

 let request;
 function renderPage(rows, page) {
  const pageSize = 30;
  const pages = Math.ceil(rows.length/pageSize);
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['工單','投入 PPID','不良 PPID','不良率']) {
   const th = document.createElement('th');
   th.scope = 'col';
   th.textContent = title;
   head.append(th);
  }
  const body = table.createTBody();
  for (const row of rows.slice(page*pageSize,(page+1)*pageSize)) {
   const tr = body.insertRow();
   for (const value of [row.order,row.input.toLocaleString(),row.count.toLocaleString(),(row.rate*100).toFixed(2)+'%']) {
    tr.insertCell().textContent = value;
   }
  }
  content.replaceChildren(table);
  if (pages < 2) return;
  const pager = document.createElement('div');
  pager.className = 'row';
  for (const [text,next] of [['上一頁',page-1],['下一頁',page+1]]) {
   const button = document.createElement('button');
   button.type = 'button';
   button.className = 'secondary';
   button.textContent = text;
   button.disabled = next < 0 || next >= pages;
   button.onclick = () => renderPage(rows,next);
   pager.append(button);
  }
  pager.append('第 '+(page+1)+'／'+pages+' 頁');
  content.append(pager);
 }
 async function refresh() {
  request?.abort();
  if (!details.open) return;
  const current = new AbortController();
  request = current;
  content.replaceChildren();
  status.textContent = '正在讀取工單明細…';
  try {
   const rows = await load(lines[Number(select.value)], current.signal);
   if (current.signal.aborted) return;
   status.textContent = rows.length ? '共 '+rows.length+' 張工單' : '本區間沒有符合條件的工單。';
   if (rows.length) renderPage(rows,0);
  } catch (error) {
   if (!current.signal.aborted) status.textContent = '無法讀取工單明細。'+error.message;
  }
 }
 details.ontoggle = refresh;
 select.onchange = refresh;
 return () => {
  details.ontoggle = null;
  select.onchange = null;
  request?.abort();
  host.replaceChildren();
 };
}

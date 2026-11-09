export function renderTrendPointTable(host, trend, {startIndex=0, onPoint, onLine}={}) {
 const {dates,series} = trend;
 const pageSize = 12;
 const pages = Math.ceil(dates.length/pageSize);
 if (!dates.length || !series.length) {
  host.textContent = '目前沒有可顯示的點位。';
  return;
 }
 function renderPage(page) {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['日期區間','製程','不良項目','投入 PPID','不良 PPID','不良率']) {
   const th = document.createElement('th');
   th.scope = 'col';
   th.textContent = title;
   head.append(th);
  }
  const body = table.createTBody();
  for (let index=page*pageSize;index<Math.min(dates.length,(page+1)*pageSize);index++) {
   const date = dates[index];
   const lines = series.filter(line => line.points[index]?.input > 0);
   if (!lines.length) {
    const tr = body.insertRow();
    tr.insertCell().textContent = date.label;
    const cell = tr.insertCell();
    cell.colSpan = 5;
    cell.textContent = date.detailStatus || '目前篩選條件無投入';
   }
   for (const [offset,line] of lines.entries()) {
    const tr = body.insertRow();
    const point = line.points[index];
    if (offset === 0) {
     const cell = tr.insertCell();
     cell.rowSpan = lines.length;
     const button = document.createElement('button');
     button.type = 'button';
     button.className = 'secondary';
     button.textContent = date.label;
     button.title = '選取此日期的工單';
     button.onclick = () => onPoint?.(index);
     cell.append(button);
     if (date.input != null) {
      const input = document.createElement('div');
      input.className = 'muted';
      input.textContent = '範圍唯一投入 '+date.input.toLocaleString()+' PPID';
      cell.append(input);
     }
    }
    tr.insertCell().textContent = line.process || '全部製程';
    const item = tr.insertCell();
    if (onLine) {
     const button = document.createElement('button');
     button.type = 'button';
     button.className = 'secondary';
     button.textContent = line.defectName || line.defect;
     button.onclick = () => onLine(line,index,button);
     item.append(button);
    } else item.textContent = line.defectName || line.defect;
    for (const value of [point.input.toLocaleString(),point.count.toLocaleString(),(point.rate*100).toFixed(2)+'%']) {
     tr.insertCell().textContent = value;
    }
   }
  }
  host.replaceChildren(table);
  if (pages < 2) return;
  const pager = document.createElement('div');
  pager.className = 'row';
  for (const [label,next] of [['上一頁',page-1],['下一頁',page+1]]) {
   const button = document.createElement('button');
   button.type = 'button';
   button.className = 'secondary';
   button.textContent = label;
   button.disabled = next < 0 || next >= pages;
   button.onclick = () => renderPage(next);
   pager.append(button);
  }
  pager.append('第 '+(page+1)+'／'+pages+' 頁 · 共 '+dates.length+' 個日期區間');
  host.append(pager);
 }
 renderPage(Math.floor(startIndex/pageSize));
}

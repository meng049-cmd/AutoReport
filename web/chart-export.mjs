import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const chartNs='http://schemas.openxmlformats.org/drawingml/2006/chart';
const drawingNs='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const relNs='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const chartRelNs='http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
function inlineCache(values,kind){
 const pointXml=values.map((value,index)=>value==null?'':`<c:pt idx="${index}"><c:v>${esc(value)}</c:v></c:pt>`).join('');
 return `<c:${kind}Cache>${kind==='num'&&'<c:formatCode>0.0%</c:formatCode>'||''}<c:ptCount val="${values.length}"/>${pointXml}</c:${kind}Cache>`;
}
function seriesXml({index,title,column,categories,values,color,line=false,sheetName='每日階段良率'}){
 const formula=`'${sheetName}'!$${column}$2:$${column}$${categories.length+1}`;
 const titleFormula=`'${sheetName}'!$${column}$1`;
 const catFormula=`'${sheetName}'!$A$2:$A$${categories.length+1}`;
 const tx=`<c:tx><c:strRef><c:f>${titleFormula}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(title)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
 const cat=`<c:cat><c:strRef><c:f>${catFormula}</c:f>${inlineCache(categories,'str')}</c:strRef></c:cat>`;
 const val=`<c:val><c:numRef><c:f>${formula}</c:f>${inlineCache(values,'num')}</c:numRef></c:val>`;
 const shape=line?`<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="396ED4"/></a:solidFill></a:ln></c:spPr>`:`<c:spPr><a:solidFill><a:srgbClr val="${String(color).replace(/^#/,'')}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`;
 const marker=line?'<c:marker><c:symbol val="none"/></c:marker>':'';
 const labels=line?'':`<c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showLeaderLines val="0"/></c:dLbls>`;
 return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}${shape}${marker}${cat}${val}${labels}</c:ser>`;
}
function chartXml(stage,rows){
 const cats=rows.map(r=>r.date),actual=rows.map(r=>r.value),targets=rows.map(()=>stage.target);
 const measured=actual.filter(value=>value!=null),isDefect=stage.kind==='defect',min=isDefect?0:Math.min(.95,Math.floor((measured.length?measured.reduce((min,value)=>Math.min(min,value),1):.95)*20)/20),max=isDefect?measured.reduce((max,value)=>Math.max(max,value),Math.max(.01,stage.target))*1.12:1.005,majorUnit=isDefect?max/5:min<.4?.1:min<.9?.05:.01,sheetName=stage.sheetName||'每日階段良率';
 const bars=seriesXml({index:0,title:stage.valueLabel||`${stage.title}良率`,sheetName,column:'B',categories:cats,values:actual,color:stage.color});
 const line=seriesXml({index:1,title:stage.referenceLabel||'Target',sheetName,column:'C',categories:cats,values:targets,line:true});
 const title=esc(stage.chartTitle||`${stage.title} 每日階段良率`);
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${chartNs}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relNs}"><c:lang val="zh-TW"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="zh-TW" sz="1500" b="1"/><a:t>${title}</a:t></a:r><a:endParaRPr lang="zh-TW"/></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${bars}<c:gapWidth val="70"/><c:overlap val="0"/><c:axId val="10"/><c:axId val="20"/></c:barChart><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${line}<c:marker val="0"/><c:smooth val="0"/><c:axId val="10"/><c:axId val="20"/></c:lineChart><c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/><c:max val="${max}"/><c:min val="${min}"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="DCE4EC"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:majorUnit val="${majorUnit}"/></c:valAx></c:plotArea><c:legend><c:legendPos val="t"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart></c:chartSpace>`;
}
function drawingXml(chartId=1){
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${drawingNs}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relNs}"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>17</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>25</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="${esc('每日階段良率圖表')}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${chartNs}"><c:chart xmlns:c="${chartNs}" xmlns:r="${relNs}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

/** Editable native combo chart, original plotted image, complete source tables and notes. */
export async function createStageChartWorkbook(stage,rows,options={}){
 const book=new ExcelJS.Workbook();book.creator='AutoReport';book.subject=stage.chartTitle||'每日階段良率';book.created=new Date();
 const sheetName=stage.sheetName||'每日階段良率';
 const sheet=book.addWorksheet(sheetName,{views:[{state:'frozen',ySplit:1}]});
 sheet.columns=[{header:stage.categoryLabel||'日期',key:'date',width:28},{header:stage.valueLabel||`${stage.title}良率`,key:'actual',width:22},{header:stage.referenceLabel||'Target',key:'target',width:18}];
 for(const row of rows)sheet.addRow({date:row.date,actual:row.value,target:stage.target});
 sheet.autoFilter={from:'A1',to:`C${rows.length+1}`};
 sheet.getRow(1).height=25;sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173B57'}};
 for(let r=2;r<=rows.length+1;r++){for(const col of [2,3])sheet.getCell(r,col).numFmt='0.00%';sheet.getRow(r).height=21;if(r%2===0)sheet.getRow(r).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F7FA'}};}
 const addTable=({name,rows,percentColumns=[]})=>{const page=book.addWorksheet(name);page.addRows(rows);page.views=[{state:'frozen',ySplit:1}];page.columns=Array.from({length:rows.reduce((max,row)=>Math.max(max,row.length),1)},()=>({width:26}));page.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};page.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173B57'}};for(let r=2;r<=rows.length;r++)for(const c of percentColumns)page.getCell(r,c+1).numFmt='0.00%';return page;};
 if(options.snapshot){const page=book.addWorksheet('已產生圖表'),image=book.addImage({base64:options.snapshot,extension:'png'}),imageWidth=Math.min(options.imageWidth||1100,1400),imageHeight=imageWidth*(options.imageHeight||320)/(options.imageWidth||1100);page.addImage(image,{tl:{col:0,row:0},ext:{width:imageWidth,height:imageHeight}});}
 for(const page of options.sheets||[])addTable(page);
 const notes=addTable({name:'統計說明',rows:[['項目','說明'],['範圍',options.scope||stage.title],['圖表','原生柱狀圖及參考線直接連結本活頁簿資料，可在Excel中編輯。'],['快照','已產生圖表分頁保留匯出當下圖像，不隨儲存格修改而更新。'],['空白日期','起訖日期之間每日保留，無數值的日期為空白，並非0%。'],['計算','每日前後段為該產品當日有資料製程良率的算術平均；全產品圖按有資料產品的階段良率算術平均。'],['唯一不良PPID','FAIL或有不良項目的GOOD均計不良；第一筆FAIL優先，沒有FAIL才採第一筆帶項目的GOOD，跨日期、跨製程僅歸屬一次。'],['貢獻加總','不良拆解各葉節點用全檔唯一PPID為分母；全部葉節點貢獻加總等於全檔PPID不良率。'],['投入分母','產品為全檔該產品唯一PPID；日期為所選日／週／月該產品唯一PPID；製程／項目為該日期區間該產品該製程唯一PPID。跨日期／製程投入不可直接相加。'],['舊版合併檔','若缺少排除AOI後的原始歸屬順序或工單，依可讀Detail及有效metadata重建；完整重現原始選檔順序請重新上傳原始檔。'],['顯示精度','百分比顯示會四捨五入；加總驗算以原始PPID數或Excel儲存的完整數值為準。'],['良率口徑','產品階段平均良率與唯一PPID不良率採不同口徑，兩者不互為補數。'],['排除製程','正面AOI、背面AOI不納入投入、不良、良率及產品身份判定；原始資料與比對仍保留。SMT不參與看板。'],['日期區間','按日、ISO週（週一至週日）或月選取起訖區間；投入按整個區間唯一PPID計算，不將每日投入直接相加。'],['不良日期篩選','依全檔首次歸屬日期篩選；不在區間內重新挑選首次不良。全部日期及無資料日期保留。'],['工單','首次不良紀錄的工單作為唯一不良歸屬；投入按該工單實際PPID去重，跨工單投入不可直接相加。'],...(options.notes||[])]});notes.getColumn(2).width=110;notes.eachRow(row=>{row.getCell(2).alignment={wrapText:true,vertical:'top'};});
 addTable({name:'資料來源',rows:[['類別','檔名','分頁','檔案大小（bytes）'],...(options.sources||[]).map(source=>['分析輸入',source.name||source,'Detail',source.size??null]),...(options.referenceSources||[]).map(name=>['IC／機種對照',name,'工單（A16）、CY26、工單（CY24&25）、重工工單1、NPI',null])]});
 const zip=await JSZip.loadAsync(await book.xlsx.writeBuffer());
 // ExcelJS emits an editAs attribute on oneCellAnchor; OOXML allows it only on twoCellAnchor.
 for(const name of Object.keys(zip.files).filter(name=>/^xl\/drawings\/drawing\d+\.xml$/.test(name))){const xml=await zip.file(name).async('string');zip.file(name,xml.replace(/(<xdr:oneCellAnchor) editAs="[^"]*"/g,'$1'));}
 const existingDrawings=Object.keys(zip.files).map(name=>name.match(/^xl\/drawings\/drawing(\d+)\.xml$/)?.[1]).filter(Boolean).map(Number),drawingId=Math.max(0,...existingDrawings)+1;
 const worksheetPath='xl/worksheets/sheet1.xml',worksheet=await zip.file(worksheetPath).async('string');
 zip.file(worksheetPath,worksheet.replace('</worksheet>','<drawing r:id="rId1"/></worksheet>'));
 zip.file('xl/worksheets/_rels/sheet1.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/drawing" Target="../drawings/drawing${drawingId}.xml"/></Relationships>`);
 zip.file(`xl/drawings/drawing${drawingId}.xml`,drawingXml());
 zip.file(`xl/drawings/_rels/drawing${drawingId}.xml.rels`,`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${chartRelNs}" Target="../charts/chart1.xml"/></Relationships>`);
 zip.file('xl/charts/chart1.xml',chartXml(stage,rows));
 const types=await zip.file('[Content_Types].xml').async('string');
 zip.file('[Content_Types].xml',types.replace('</Types>',`<Override PartName="/xl/drawings/drawing${drawingId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`));
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

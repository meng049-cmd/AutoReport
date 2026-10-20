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
function seriesXml({index,title,column,categories,values,color,line=false}){
 const formula=`'每日階段良率'!$${column}$2:$${column}$${categories.length+1}`;
 const titleFormula=`'每日階段良率'!$${column}$1`;
 const catFormula=`'每日階段良率'!$A$2:$A$${categories.length+1}`;
 const tx=`<c:tx><c:strRef><c:f>${titleFormula}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(title)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
 const cat=`<c:cat><c:strRef><c:f>${catFormula}</c:f>${inlineCache(categories,'str')}</c:strRef></c:cat>`;
 const val=`<c:val><c:numRef><c:f>${formula}</c:f>${inlineCache(values,'num')}</c:numRef></c:val>`;
 const shape=line?`<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="396ED4"/></a:solidFill></a:ln></c:spPr>`:`<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`;
 const marker=line?'<c:marker><c:symbol val="none"/></c:marker>':'';
 const labels=line?'':`<c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showLeaderLines val="0"/></c:dLbls>`;
 return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}${shape}${marker}${cat}${val}${labels}</c:ser>`;
}
function chartXml(stage,rows){
 const cats=rows.map(r=>r.date),actual=rows.map(r=>r.value),targets=rows.map(()=>stage.target);
 const measured=actual.filter(value=>value!=null),min=Math.min(.95,Math.floor((measured.length?Math.min(...measured):.95)*20)/20),majorUnit=min<.4?.1:min<.9?.05:.01;
 const bars=seriesXml({index:0,title:`${stage.title}良率`,column:'B',categories:cats,values:actual,color:stage.color});
 const line=seriesXml({index:1,title:'Target',column:'C',categories:cats,values:targets,line:true});
 const title=esc(`${stage.title} 每日階段良率`);
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${chartNs}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relNs}"><c:lang val="zh-TW"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="zh-TW" sz="1500" b="1"/><a:t>${title}</a:t></a:r><a:endParaRPr lang="zh-TW"/></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${bars}<c:gapWidth val="70"/><c:overlap val="0"/><c:axId val="10"/><c:axId val="20"/></c:barChart><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${line}<c:marker val="0"/><c:smooth val="0"/><c:axId val="10"/><c:axId val="20"/></c:lineChart><c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/><c:max val="1.005"/><c:min val="${min}"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="DCE4EC"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:majorUnit val="${majorUnit}"/></c:valAx></c:plotArea><c:legend><c:legendPos val="t"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart></c:chartSpace>`;
}
function drawingXml(){
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${drawingNs}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relNs}"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>17</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>25</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="${esc('每日階段良率圖表')}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${chartNs}"><c:chart xmlns:c="${chartNs}" xmlns:r="${relNs}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
}

/** Create a normal editable XLSX with its native Excel combo chart and editable source cells. */
export async function createStageChartWorkbook(stage,rows){
 const book=new ExcelJS.Workbook();book.creator='AutoReport';book.subject='每日階段良率';book.created=new Date();
 const sheet=book.addWorksheet('每日階段良率',{views:[{state:'frozen',ySplit:1}]});
 sheet.columns=[{header:'日期',key:'date',width:16},{header:`${stage.title}良率`,key:'actual',width:18},{header:'Target',key:'target',width:14}];
 for(const row of rows)sheet.addRow({date:row.date,actual:row.value,target:stage.target});
 sheet.autoFilter={from:'A1',to:`C${rows.length+1}`};
 sheet.getRow(1).height=25;sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF173B57'}};
 for(let r=2;r<=rows.length+1;r++){for(const col of [2,3])sheet.getCell(r,col).numFmt='0.0%';sheet.getRow(r).height=21;if(r%2===0)sheet.getRow(r).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F7FA'}};}
 sheet.getCell('E1').value='圖表說明';sheet.getCell('E1').font={bold:true,color:{argb:'FF173B57'}};sheet.getCell('E2').value='藍線為目標值；空白日期會保留在資料表與圖表日期軸。可直接修改 A:C 欄資料。';sheet.getCell('E2').alignment={wrapText:true,vertical:'top'};sheet.getColumn(5).width=44;sheet.getRow(2).height=42;
 let zip=await JSZip.loadAsync(await book.xlsx.writeBuffer());
 const worksheetPath='xl/worksheets/sheet1.xml',worksheet=await zip.file(worksheetPath).async('string');
 zip.file(worksheetPath,worksheet.replace('</worksheet>','<drawing r:id="rId1"/></worksheet>'));
 zip.file('xl/worksheets/_rels/sheet1.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
 zip.file('xl/drawings/drawing1.xml',drawingXml());
 zip.file('xl/drawings/_rels/drawing1.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${chartRelNs}" Target="../charts/chart1.xml"/></Relationships>`);
 zip.file('xl/charts/chart1.xml',chartXml(stage,rows));
 const types=await zip.file('[Content_Types].xml').async('string');
 zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>'));
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

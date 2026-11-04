export const MAX_BYTES=100*1024*1024;
export const MAX_ROWS=1048576;
export const MAX_COLUMNS=16384;
export function validateYieldFiles(files){
 if(!Array.isArray(files)||!files.length)throw Error('請選擇至少 1 份含 Detail 分頁的 .xlsx 檔案。');
 if(files.some(file=>typeof file?.name!=='string'||!file.name.toLowerCase().endsWith('.xlsx')||!Number.isFinite(file.size)||file.size<=0))throw Error('請選擇有效且非空白的 .xlsx Detail 檔案。');
}
export function validateDetailFiles(files){
 if(!files.length||files.length>30||files.some(file=>!file.name.toLowerCase().endsWith('.xlsx')||!file.size||file.size>MAX_BYTES)||files.reduce((n,file)=>n+file.size,0)>MAX_BYTES)throw Error('請選擇 1 至 30 份 .xlsx，合計 100 MB 以內。');
}

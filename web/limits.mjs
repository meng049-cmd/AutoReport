export const MAX_BYTES=100*1024*1024;
export const MAX_ROWS=1048576;
export const MAX_COLUMNS=16384;
export function validateDetailFiles(files){
 if(!files.length||files.length>30||files.some(file=>!file.name.toLowerCase().endsWith('.xlsx')||!file.size||file.size>MAX_BYTES)||files.reduce((n,file)=>n+file.size,0)>MAX_BYTES)throw Error('請選擇 1 至 30 份 .xlsx，合計 100 MB 以內。');
}

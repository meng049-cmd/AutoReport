const version=new URL(self.location.href).search;
importScripts('vendor/xlsx.full.min.js'+version, 'merge-core.js'+version);
self.onmessage = async ({data}) => {
  try {
    const files=Array.isArray(data)?data:data.files,merger = new DetailMerger(XLSX,{skipInvalidRows:!Array.isArray(data)&&data.skipInvalidRows===true});
    for (let i = 0; i < files.length; i++) {
      self.postMessage({type: 'progress', message: `正在讀取 ${i + 1}/${files.length}：${files[i].name}`});
      const bytes = await files[i].arrayBuffer();
      merger.add(DetailMerger.readBook(XLSX,bytes), files[i].name);
    }
    self.postMessage({type:'progress', message:'正在排序、產生下載檔案…'});
    const {book, ...stats} = merger.finish();
    const bytes = XLSX.write(book, {bookType:'xlsx', type:'array', compression:true});
    self.postMessage({type:'complete', ...stats, bytes}, [bytes]);
  } catch (error) { self.postMessage({type:'error', message:error.message || '處理失敗，請確認檔案格式。'}); }
};

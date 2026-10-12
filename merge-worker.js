importScripts('vendor/xlsx.full.min.js', 'merge-core.js');
self.onmessage = async ({data: files}) => {
  try {
    const merger = new DetailMerger(XLSX);
    for (let i = 0; i < files.length; i++) {
      self.postMessage({type: 'progress', message: `正在讀取 ${i + 1}/${files.length}：${files[i].name}`});
      const bytes = await files[i].arrayBuffer();
      merger.add(XLSX.read(bytes, {type:'array', dense:true}), files[i].name);
    }
    self.postMessage({type:'progress', message:'正在排序、產生下載檔案…'});
    const {book, ...stats} = merger.finish();
    const bytes = XLSX.write(book, {bookType:'xlsx', type:'array', compression:true});
    self.postMessage({type:'complete', ...stats, bytes}, [bytes]);
  } catch (error) { self.postMessage({type:'error', message:error.message || '處理失敗，請確認檔案格式。'}); }
};

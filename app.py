import logging
from pathlib import Path
from uuid import uuid4
from zipfile import BadZipFile

from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.exceptions import RequestEntityTooLarge

from merge import merge_detail

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024
storage = Path(app.instance_path) / 'reports'
storage.mkdir(parents=True, exist_ok=True)


@app.get('/')
def index():
    return render_template('index.html')


@app.post('/api/merge')
def merge():
    files = request.files.getlist('files')
    if not files or len(files) > 30 or any(not f.filename.lower().endswith('.xlsx') for f in files):
        return jsonify(error='請上傳 1 至 30 份 .xlsx 檔案。'), 400
    token = uuid4().hex
    folder = storage / token
    folder.mkdir()
    paths = []
    try:
        for index, file in enumerate(files):
            path = folder / f'{index + 1:02d}_{Path(file.filename).name}'
            file.save(path)
            paths.append(path)
        result = merge_detail(paths, folder)
        result['download_url'] = f'/download/{token}'
        return jsonify(result)
    except (ValueError, BadZipFile, KeyError) as error:
        return jsonify(error=str(error)), 400
    except Exception:
        logging.exception('Report merge failed')
        return jsonify(error='檔案處理失敗，請確認 Excel 格式後重試。'), 500
    finally:
        for path in paths:
            path.unlink(missing_ok=True)
        if not any(folder.iterdir()):
            folder.rmdir()


@app.get('/download/<token>')
def download(token):
    if len(token) != 32 or any(c not in '0123456789abcdef' for c in token):
        return jsonify(error='找不到下載檔案。'), 404
    files = list((storage / token).glob('*.xlsx'))
    if len(files) != 1:
        return jsonify(error='找不到下載檔案。'), 404
    return send_file(files[0], as_attachment=True, download_name=files[0].name)


@app.errorhandler(RequestEntityTooLarge)
def too_large(error):
    return jsonify(error='上傳檔案總大小不可超過 100 MB。'), 413


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)

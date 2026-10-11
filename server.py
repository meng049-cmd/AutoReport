"""Local upload/search UI. Files used for matching are not retained or imported."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import autoreport as a


class Handler(BaseHTTPRequestHandler):
    def respond(self, payload, content_type='application/json; charset=utf-8', status=200, filename=None):
        if not isinstance(payload, bytes):
            payload = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        try:
            if url.path == '/':
                return self.respond((a.ROOT / 'index.html').read_bytes(), 'text/html; charset=utf-8')
            if url.path == '/api/database':
                return self.respond(self.server.db_path.read_bytes(), 'application/vnd.sqlite3', filename='autoreport.sqlite3')
            with a.connect(self.server.db_path) as db:
                if url.path == '/api/stats':
                    return self.respond(a.stats(db))
                if url.path == '/api/query':
                    kind = query.get('kind', ['any'])[0]
                    if kind not in {'any', 'order', 'part', 'dpn', 'model', 'ic'}:
                        raise ValueError('不支援的查找欄位。')
                    return self.respond(a.lookup(db, [(kind, query.get('q', [''])[0])]))
                if url.path == '/api/search':
                    return self.respond(a.search(db, query.get('q', [''])[0]))
            self.respond({'error': '找不到頁面。'}, status=404)
        except ValueError as exc:
            self.respond({'error': str(exc)}, status=400)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path not in {'/api/match', '/api/export'}:
            return self.respond({'error': '找不到功能。'}, status=404)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 20 * 1024 * 1024:
                raise ValueError('檔案必須介於 1 byte 至 20 MB。')
            payload = self.rfile.read(size)
            filename = parse_qs(url.query).get('filename', [''])[0]
            with a.connect(self.server.db_path) as db:
                result = a.match_upload(db, payload, filename)
            if url.path == '/api/export':
                return self.respond(a.export_matches(result),
                                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                    filename='match-results.xlsx')
            self.respond(result)
        except (ValueError, KeyError, OSError, a.ET.ParseError, a.sqlite3.Error) as exc:
            self.respond({'error': '處理失敗：' + str(exc)}, status=400)
        except Exception:
            self.respond({'error': '無法讀取檔案，請確認檔案為未加密且格式完整的 XLSX／CSV。'}, status=400)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--db', type=a.Path, default=a.DEFAULT_DB)
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error('資料庫不存在，請先執行 autoreport.py import。')
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.db_path = args.db
    print(f'AutoReport listening on {args.host}:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()

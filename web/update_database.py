"""Append Excel reference rows atomically; keep old mappings and skip duplicates."""
import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import autoreport as a


def signature(row):
    return (a.norm(row['model']), a.norm(row['ic']), a.norm(row['family']),
            *(tuple(sorted({a.norm(v) for v in json.loads(row[field])}))
              for field in ('parts_json', 'dpns_json', 'orders_json')))


def append_excel(database, excel, metadata=None, commit=None):
    database, excel = Path(database), Path(excel)
    if excel.suffix.lower() != '.xlsx' or not excel.is_file():
        raise ValueError('請上傳 Excel 原始對照資料（.xlsx）。')
    if not 0 < excel.stat().st_size <= 20 * 1024 * 1024:
        raise ValueError('來源 Excel 必須介於 1 byte 與 20 MB。')
    if not database.is_file():
        raise ValueError('缺少既有資料庫；追加更新不會建立空白資料庫。')
    payload = excel.read_bytes()
    database.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=database.parent, prefix='.database-update-') as temp:
        candidate = Path(temp) / 'candidate.sqlite3'
        with sqlite3.connect(f'{database.resolve().as_uri()}?mode=ro', uri=True) as old, sqlite3.connect(candidate) as new:
            old.backup(new)
        db = a.connect(candidate)
        try:
            seen = {signature(row) for row in db.execute(a.RECORD_SQL)}
            last_id = db.execute('SELECT COALESCE(MAX(id),0) FROM records').fetchone()[0]
            imported = a.import_excel(db, payload, excel.name)
            if imported['duplicate']:
                return {'added_records': 0, 'skipped_records': 0, 'unchanged': True}
            source_id = imported['source_id']
            duplicates = []
            added = 0
            for row in db.execute(a.RECORD_SQL + ' WHERE r.id>? ORDER BY r.id', (last_id,)):
                key = signature(row)
                if key in seen:
                    duplicates.append((row['id'],))
                else:
                    seen.add(key)
                    added += 1
            with db:
                for table in ('lookup_keys', 'work_orders'):
                    db.executemany(f'DELETE FROM {table} WHERE record_id=?', duplicates)
                db.executemany('DELETE FROM records WHERE id=?', duplicates)
                db.execute('UPDATE sheets SET indexed_rows=(SELECT COUNT(*) FROM records WHERE sheet_id=sheets.id) WHERE source_id=?', (source_id,))
            if added == 0:
                return {'added_records': 0, 'skipped_records': len(duplicates), 'unchanged': True}
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'SQLite integrity check failed'
            assert not db.execute('PRAGMA foreign_key_check').fetchall(), 'SQLite foreign key check failed'
            summary = {'updated_at': datetime.now(timezone.utc).isoformat(), 'source_file': excel.name,
                       'source_sha256': hashlib.sha256(payload).hexdigest(), 'source_commit': commit,
                       'added_records': added, 'skipped_records': len(duplicates),
                       'total_records': a.stats(db)['索引資料列'], 'mode': 'append'}
        finally:
            db.close()
        # All parsing and validation completed before touching the active database.
        os.replace(candidate, database)
        if metadata:
            metadata = Path(metadata)
            metadata.parent.mkdir(parents=True, exist_ok=True)
            tmp = metadata.with_suffix('.json.tmp')
            tmp.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            os.replace(tmp, metadata)
        return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('excel', type=Path)
    parser.add_argument('--db', type=Path, default=a.DEFAULT_DB)
    parser.add_argument('--metadata', type=Path, default=a.ROOT / 'data' / 'database-update.json')
    parser.add_argument('--commit')
    args = parser.parse_args()
    print(json.dumps(append_excel(args.db, args.excel, args.metadata, args.commit), ensure_ascii=False, indent=2))

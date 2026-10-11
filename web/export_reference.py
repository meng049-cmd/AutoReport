"""Export the prepared database without modifying it for the browser matcher."""
import json
import sqlite3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import autoreport

path = Path(sys.argv[1])
with sqlite3.connect(f'file:{autoreport.DEFAULT_DB}?mode=ro', uri=True) as db:
    db.row_factory = sqlite3.Row
    records = []
    for row in db.execute(autoreport.RECORD_SQL + ' ORDER BY r.id'):
        r = autoreport.present(row)
        r['search_text'] = row['search_text']
        records.append(r)
    data = {'stats': autoreport.stats(db), 'records': records,
            'keys': [list(r) for r in db.execute('SELECT kind,value,record_id FROM lookup_keys ORDER BY kind,value,record_id')]}
metadata = autoreport.ROOT / 'data' / 'database-update.json'
data['database_update'] = json.loads(metadata.read_text(encoding='utf-8')) if metadata.exists() else None
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

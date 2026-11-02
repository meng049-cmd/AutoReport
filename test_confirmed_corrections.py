import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path
import autoreport as a
spec=importlib.util.spec_from_file_location('update_database',Path(__file__).parent/'web/update_database.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)

class ConfirmedCorrectionsTest(unittest.TestCase):
    def test_persistence_reconfirm_and_failed_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'data.sqlite3'
            with a.connect(path) as db: db.commit()
            first=dict(order='MISS1',part='PART1',ic='Goodix',model='CY26')
            u.save_corrections(path,[first])
            u.save_corrections(path,[first])
            with sqlite3.connect(path) as db:
                self.assertEqual(len(u.confirmed_corrections(db)),1)
            with self.assertRaises(ValueError):u.save_corrections(path,[dict(first,model='bad'),dict(order='',ic='x',model='x')])
            with sqlite3.connect(path) as db:self.assertEqual(u.confirmed_corrections(db)[0]['model'],'CY26')
            u.save_corrections(path,[dict(first,model='new'),dict(first,part='PART2')])
            with sqlite3.connect(path) as db:
                self.assertEqual(len(u.confirmed_corrections(db)),2)
                self.assertEqual(u.confirmed_corrections(db)[0]['model'],'new')
                self.assertEqual(db.execute('pragma integrity_check').fetchone()[0],'ok')

if __name__=='__main__':unittest.main()

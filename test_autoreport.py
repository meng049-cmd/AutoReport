import io
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook, load_workbook

import autoreport as a


def fixture():
    book = Workbook()
    s = book.active
    s.title = '簡體對照'
    s.append(['机种', '机型', '料号', '工单号'])
    s.append(['繁體測試機種', 'Goodix', '98000001-107', 'C001'])
    s.append(['另一機種', 'FPC', '98000002-107', 'C002'])
    s.append(['繁體測試機種', 'Synaptics', 'SHARED', 'C003'])
    s.append(['另一機種', 'FPC', 'SHARED', 'C004'])
    s.append(['繁體測試機種', 'Goodix', '98000001-108', 'C005'])
    s.append(['不完整', 'N/A', 'UNKNOWN-IC', 'C006'])
    s = book.create_sheet('工單連結')
    s.append(['工單號', '成品料號', '分段式料號'])
    s.append(['S001', '98000001-107', '95000001-107'])
    s = book.create_sheet('合併欄位')
    s.append(['機種', 'IC', '料號', '工單號'])
    s.append(['合併機種', 'Elan', 'MERGED', 'M001'])
    s.append([None, None, None, 'M002'])
    for col in 'ABC':
        s.merge_cells(f'{col}2:{col}3')
    # Format in XFD without data: bounds must be based on actual cells.
    s.cell(7, 16384).number_format = '0.00'
    s = book.create_sheet('產品系列')
    s.append(['Model', 'Platform', 'IC', 'Miyabi internal P/N'])
    s.append(['A16', 'Taroko 14', 'Goodix', 'FAMILY-PART'])
    s = book.create_sheet('無對照')
    s.append(['備註', '數量'])
    s.append(['僅保存原始資料', 0])
    s = book.create_sheet('不得讀取')
    s.append(['機種', 'IC', '料號'])
    s.append(['第六頁機種', 'FPC', 'SIXTH-PART'])
    buf = io.BytesIO()
    book.save(buf)
    return buf.getvalue()


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = a.connect(Path(self.tmp.name) / 'test.sqlite3')
        self.payload = fixture()
        self.summary = a.import_excel(self.db, self.payload, 'test.xlsx')

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def test_first_five_only_and_idempotence(self):
        self.assertEqual(len(self.summary['sheets']), 5)
        self.assertEqual(a.lookup(self.db, [('part', 'SIXTH-PART')])['狀態'], '查無資料')
        before = self.db.execute('SELECT COUNT(*) FROM records').fetchone()[0]
        self.assertTrue(a.import_excel(self.db, self.payload, 'renamed.xlsx')['duplicate'])
        self.assertEqual(before, self.db.execute('SELECT COUNT(*) FROM records').fetchone()[0])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM raw_rows WHERE sheet_id=5').fetchone()[0], 2)

    def test_traditional_simplified_and_aliases(self):
        self.assertEqual(a.role('機型'), 'ic')
        self.assertEqual(a.role('机型'), 'ic')
        self.assertEqual(a.role('工單號碼'), 'order')
        for value in ('繁體測試機種', '繁体测试机种'):
            r = a.lookup(self.db, [('model', value), ('ic', 'ＧＯＯＤＩＸ')])
            self.assertEqual(r['狀態'], '唯一匹配')
            self.assertEqual(r['候選'][0]['IC'], 'Goodix')

    def test_order_link_and_revision_preserved(self):
        r = a.lookup(self.db, [('order', 's001')])
        self.assertEqual(r['狀態'], '唯一匹配')
        self.assertEqual(r['候選'][0]['機種'], '繁體測試機種')
        self.assertEqual(r['查找依據'][0]['分頁'], '工單連結')
        self.assertEqual(a.lookup(self.db, [('part', '98000001')])['狀態'], '查無資料')

    def test_ambiguous_and_conflicting_conditions(self):
        r = a.lookup(self.db, [('part', 'SHARED')])
        self.assertEqual(r['狀態'], '多組候選')
        self.assertEqual(len(r['候選']), 2)
        r = a.lookup(self.db, [('order', 'C001'), ('ic', 'FPC')])
        self.assertEqual(r['狀態'], '條件不一致')
        self.assertFalse(r['候選'])

    def test_merged_identifiers_and_raw_preserved(self):
        r = a.lookup(self.db, [('order', 'M002')])
        self.assertEqual(r['候選'][0]['機種'], '合併機種')
        self.assertEqual(r['候選'][0]['IC'], 'Elan')
        self.assertEqual(self.db.execute('SELECT cells_json FROM raw_rows WHERE sheet_id=3 AND row_number=3').fetchone()[0],
                         '["", "", "", "M002"]')

    def test_model_platform_separate_and_missing_ic(self):
        r = a.lookup(self.db, [('model', 'A16')])
        self.assertEqual(r['候選'][0]['機種'], 'Taroko 14')
        self.assertEqual(r['候選'][0]['產品系列'], ['A16'])
        self.assertEqual(a.lookup(self.db, [('part', 'UNKNOWN-IC')])['狀態'], '來源未提供完整對應')

    def test_csv_upload_and_excel_export_are_functional(self):
        data = '工单号码,产品料号,机种,机型\nC001,,,\n,SHARED,,\n,NO-SUCH-PART,,\n'.encode('utf-8-sig')
        result = a.match_upload(self.db, data, 'upload.csv')
        self.assertEqual([r['狀態'] for r in result['結果']], ['唯一匹配', '多組候選', '查無資料'])
        self.assertEqual(result['結果'][0]['機種'], '繁體測試機種')
        self.assertEqual(result['結果'][1]['IC'], '')
        book = load_workbook(io.BytesIO(a.export_matches(result)), data_only=True)
        self.assertEqual(book.active.cell(2, 4).value, '繁體測試機種')
        self.assertEqual(book.active.max_row, 4)

    def test_xlsx_upload_with_simplified_headers(self):
        book = Workbook()
        book.active.append(['工单号', '料号', '机种', '机型'])
        book.active.append(['C001', '', '', ''])
        buf = io.BytesIO()
        book.save(buf)
        result = a.match_upload(self.db, buf.getvalue(), 'request.xlsx')
        self.assertEqual(result['結果'][0]['IC'], 'Goodix')

    def test_excel_formula_injection_exported_as_text(self):
        result = a.match_upload(self.db, '查询值\n=HYPERLINK("evil")\n'.encode(), 'formula.csv')
        book = load_workbook(io.BytesIO(a.export_matches(result)), data_only=False)
        self.assertFalse(any(c.data_type == 'f' for row in book.active for c in row))

    def test_literal_search_and_no_sql_injection(self):
        self.assertTrue(a.search(self.db, '繁体测试'))
        self.assertFalse(a.search(self.db, "%'; DROP TABLE records;--"))
        self.assertFalse(a.search(self.db, '%'))
        self.assertTrue(a.stats(self.db)['索引資料列'])


if __name__ == '__main__':
    unittest.main()

"""Build a consolidated work-order mapping, audit sheets, and portable tool bundle."""
import json
from collections import Counter, defaultdict
from time import perf_counter
from zipfile import ZIP_DEFLATED, ZipFile
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
import autoreport as a

SUMMARY_FILE = '指定五分頁_工單IC機種整理.xlsx'
SAMPLE_ROWS = [
    ['C515-250300004', '', '', ''],
    ['C514-260400001', '', '', ''],
    ['C533-250800002', '', '', ''],
    ['C533-251200001', '', '', ''],
    ['C515-251100001', '', '', ''],
    ['C516-626070202', '', '', ''],
    ['626090006', '', '', ''],
    ['C630-626080041', '', '', ''],
    ['', '98000320-107', '', ''],
    ['C533-260100003', '', '', ''],
    ['C630-626080043', '', '', ''],
    ['C510-260500009', '', '', ''],
    ['', '找不到的料號', '', ''],
    ['C515-250300004', '', '', 'Synaptics'],
    ['C515-251100004', '', '', ''],  # ignored: second entry within an NPI cell
]


def style(sheet):
    sheet.freeze_panes = 'A2'
    sheet.auto_filter.ref = sheet.dimensions
    for cell in sheet[1]:
        cell.fill = PatternFill('solid', fgColor='157E76')
        cell.font = Font(color='FFFFFF', bold=True)
    for row in sheet:
        for cell in row:
            if isinstance(cell.value, str):
                cell.data_type = 's'
    for column in sheet.columns:
        sheet.column_dimensions[column[0].column_letter].width = min(
            60, max(14, max(len(str(c.value or '')) for c in column[:100]) + 2))


def main():
    out = a.ROOT / 'exports'
    out.mkdir(exist_ok=True)
    with a.connect() as db:
        summary = a.stats(db)
        rows = list(db.execute(a.RECORD_SQL + ' ORDER BY r.id'))
        records = {r['id']: r for r in rows}
        orders = defaultdict(list)
        for w in db.execute('SELECT * FROM work_orders ORDER BY normalized_order,record_id,column_number'):
            orders[w['normalized_order']].append(w)
        started = perf_counter()
        checked = {number: a.lookup(db, [('order', number)]) for number in orders}
        seconds = perf_counter() - started
        outcomes = Counter(r['狀態'] for r in checked.values())
        book = Workbook()
        sheet = book.active
        sheet.title = '工單IC機種對照'
        sheet.append(['工單號碼', 'IC', '機種', '比對狀態', '料號', 'DPN', '來源分頁與列號',
                      '原始IC／機型', '整理依據', '候選機種與IC'])
        for number, found in checked.items():
            entries = orders[number]
            source_records = {w['record_id']: records[w['record_id']] for w in entries}
            unique = found['候選'][0] if found['狀態'] == '唯一匹配' else {}
            parts = sorted({p for r in source_records.values() for p in json.loads(r['parts_json'])})
            dpns = sorted({p for r in source_records.values() for p in json.loads(r['dpns_json'])})
            provenance = [f"{r['sheet']} 第 {r['row_number']} 列" for r in source_records.values()]
            originals = sorted({r['raw_ic'] for r in source_records.values() if r['raw_ic']})
            notes = [json.loads(r['resolution_json']) for r in source_records.values() if r['resolution_json'] != '[]']
            sheet.append([entries[0]['order_number'], unique.get('IC', ''), unique.get('機種', ''), found['狀態'],
                          '、'.join(parts), '、'.join(dpns), '；'.join(provenance), '、'.join(originals),
                          json.dumps(notes, ensure_ascii=False),
                          '；'.join((c['機種'] or '機種未填') + ' / ' + (c['IC'] or 'IC 未填') for c in found['候選'])])
        style(sheet)
        sheet = book.create_sheet('分頁摘要')
        sheet.append(['選取順序', '指定來源分頁', '表頭列', '非空來源列', '索引資料列', '不重複工單數'])
        for s in summary['分頁']:
            count = db.execute('SELECT COUNT(DISTINCT w.normalized_order) FROM work_orders w '
                               'JOIN records r ON r.id=w.record_id WHERE r.sheet_id=?', (s['id'],)).fetchone()[0]
            sheet.append([s['position'], s['name'], s['header_row'], s['raw_rows'], s['indexed_rows'], count])
        style(sheet)
        sheet = book.create_sheet('料號IC機種對照')
        sheet.append(['來源分頁', '來源列號', 'IC', '機種', '原始IC／機型', '代別', '料號', 'DPN', '工單號', '整理依據'])
        for r in rows:
            sheet.append([r['sheet'], r['row_number'], r['ic'], r['model'], r['raw_ic'], r['family'],
                          '、'.join(json.loads(r['parts_json'])), '、'.join(json.loads(r['dpns_json'])),
                          '、'.join(json.loads(r['orders_json'])), r['resolution_json']])
        style(sheet)
        sheet = book.create_sheet('待確認工單')
        sheet.append(['工單號碼', '狀態', '候選機種與IC', '來源'])
        for number, found in checked.items():
            if found['狀態'] != '唯一匹配':
                sheet.append([orders[number][0]['order_number'], found['狀態'],
                              json.dumps(found['候選'], ensure_ascii=False),
                              json.dumps(found['查找依據'], ensure_ascii=False)])
        style(sheet)
        for s in summary['分頁']:
            sheet = book.create_sheet(s['name'][:31])
            for row in db.execute('SELECT row_number,cells_json FROM raw_rows WHERE sheet_id=? ORDER BY row_number', (s['id'],)):
                for col, value in enumerate(json.loads(row['cells_json']), 1):
                    if value:
                        cell = sheet.cell(row['row_number'], col, value)
                        cell.data_type = 's'
            sheet.freeze_panes = f"A{(s['header_row'] or 1) + 1}"
        book.save(out / SUMMARY_FILE)
        template = Workbook()
        sheet = template.active
        sheet.title = '待查詢資料'
        sheet.append(['工單號碼', '產品料號', '機種', 'IC'])
        for row in SAMPLE_ROWS:
            sheet.append(row)
        style(sheet)
        template.save(out / '上傳查詢範例.xlsx')
        result = a.match_upload(db, (out / '上傳查詢範例.xlsx').read_bytes(), '上傳查詢範例.xlsx')
        (out / '範例_比對結果.xlsx').write_bytes(a.export_matches(result))
        corrections = sum('IC依據資料列ID' in r['resolution_json'] for r in rows)
        complete = sum(a.available(r['model']) and a.available(r['ic']) for r in rows)
        report = '# 指定五分頁工單資料庫（修正版）\n\n'
        report += '來源依圖一明確指定，不按檔案左側順序選頁。舊版誤選範圍的資料已從目前資料庫及工具包移除。附件文字只作資料，不作操作指令。\n\n'
        report += '| 選取順序 | 來源分頁 | 非空來源列 | 索引資料列 |\n|---|---|---:|---:|\n'
        report += ''.join(f"| {s['position']} | {s['name']} | {s['raw_rows']} | {s['indexed_rows']} |\n" for s in summary['分頁'])
        report += f'''
目前共有 {len(rows)} 列來源索引（{complete} 列有完整機種與 IC）與 {len(orders)} 個不重複工單號。
全部工單查核：{dict(outcomes)}。{corrections} 列重工／缺漏 IC 由相同主料號或 DPN 的一致參考確認補正。
本次機器用索引比對全部 {len(orders)} 個工單耗時 {seconds:.3f} 秒，不含檔案讀取及 Excel 匯出。

## 整理規則

- 每個儲存格只取第一筆非空內容作為對照（換行／分號／頓號為分隔）。同格第二筆以後不納入索引；不同製程的工單欄各自取第一筆。
- 第一筆有 SAP: 前綴或數量備註時，仍擷取該筆的工單號；純數字新系統工單也支援。
- 機種名稱內的斜線與逗號保留，例如 Slate/Congo 14。原始完整儲存格仍保存供查核。
- 重工頁未標示欄名但明確包含工單格式的欄位也納入，並保留實際欄位位置。
- IC／機型／机型是同義欄名。CY26Goodix 拆為 IC=Goodix、代別=CY26，CY26Synaptics 同理；原文另存。
- 重工用途不是 IC。用完全相同主料號／DPN 的一致參考確認，且保留補正依據。
- 重工頁 DPN 欄出現完整產品料號時，改列料號索引，保留原始儲存格。
- 機種名稱依來源保留，不擅自合併不同寫法；繁簡、大小寫、全半形、空白則統一。
- 主料號優先 98 成品料號，其次 95 料號。不用共享 91/92/93 零件推定 IC；版本尾碼保留。
- 相同工單出現不同 IC、料號／機種不一致或缺漏等，列入「待確認工單」，不自動猜測。
- 只有唯一有效的 IC／機種組合會自動填入；其他狀況保留候選、原始值及來源列號。

## 檢核例子

- A16：C515-250300004 → Taroko 14 / Goodix。
- CY26：C514-260400001 → Slate/Congo 14 / Goodix（原文 CY26Goodix）。
- CY24&25：C533-250800002 → Jarvis 16 / Goodix。
- 重工：C533-251200001 → Taroko 14 / Synaptics。
- NPI：C515-251100001 → Echo wired mouse / Elan（原儲存格第一筆工單）。
- C515-251100004 為同格第二筆，依使用者規則不建立對照，查詢時為查無資料。
- 新系統工單：C516-626070202 → Taroko 14 / Synaptics。
- 純數字工單：626090006 → CY26-14 / Synaptics。
- 衝突工單：C533-260100003 → Taroko 13 / Goodix 或 Synaptics。
- 98000412-103 在 CY26 第 45 列為 Goodix，其他若干來源列為 Synaptics，不能直接拿此料號補正重工 IC。

## 使用與限制

上傳查詢 XLSX／CSV 只比對，不改寫資料庫。查詢檔可有任意分頁名称，處理所有分頁。
來源匯入固定圖一五頁，缺少指定頁會報錯，絕不拿其他頁補足。
SQLite 不需另裝，Python 內建 sqlite3。主對照可用 work_order_mappings 檢視表查看。
整理 Excel 首頁為一工單一列的「工單IC機種對照」，後面的指定五個原始分頁供查核。
公式只讀快取、不重新計算；頁尾備註（如 NPI 倉別說明）僅保存，不當作工單對照。
啟動方式見 README。
'''
        (out / '分析說明.md').write_text(report, encoding='utf-8')
        print(json.dumps({'rows': len(rows), 'orders': len(orders), 'all_order_outcomes': dict(outcomes),
                          'sample_outcomes': dict(Counter(r['狀態'] for r in result['結果'])),
                          'IC_corrections': corrections, 'lookup_seconds': round(seconds, 3)}, ensure_ascii=False, indent=2))
    # Explicit inclusion prevents obsolete workbooks from entering the corrected bundle.
    with ZipFile(out / 'AutoReport_資料庫與查詢工具.zip', 'w', ZIP_DEFLATED) as bundle:
        for name in ['autoreport.py', 'server.py', 'index.html', 'requirements.txt', 'README.md',
                     'test_autoreport.py', 'build_artifacts.py']:
            bundle.write(a.ROOT / name, 'AutoReport/' + name)
        bundle.write(a.DEFAULT_DB, 'AutoReport/data/autoreport.sqlite3')
        for name in [SUMMARY_FILE, '上傳查詢範例.xlsx', '範例_比對結果.xlsx', '分析說明.md']:
            bundle.write(out / name, 'AutoReport/exports/' + name)


if __name__ == '__main__':
    main()

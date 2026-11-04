"""Opt-in native Excel regression; never launches Excel without --run-native.

Run with a Python environment containing pypdf. This creates only synthetic
private files inside Excel's own tmp container, leaves other workbooks open,
and removes its private test directory on every exit. No preferences change.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile
from xml.sax.saxutils import escape
import zipfile

REPO = Path(__file__).resolve().parents[1]
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'


def make_fixture(path):
    """Write a metadata-free fixture whose printed markers define the oracle."""
    sheets = [('Cover', 8), ('Detail', 90), ('Hidden', 3)]
    types = ['<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
    tabs, relationships, names = [], [], []
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for index, (name, rows) in enumerate(sheets, 1):
            state = ' state="hidden"' if name == 'Hidden' else ''
            tabs.append(f'<sheet name="{name}" sheetId="{index}" r:id="rId{index}"{state}/>')
            relationships.append(f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>')
            types.append(f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
            names.extend([
                f'<definedName name="_xlnm.Print_Area" localSheetId="{index-1}">\'{name}\'!$A$1:$C${rows}</definedName>',
                f'<definedName name="_xlnm.Print_Titles" localSheetId="{index-1}">\'{name}\'!$1:$1</definedName>',
            ])
            data = []
            for row in range(1, rows + 1):
                label = f'{name.upper()}_REPEATED_TITLE' if row == 1 else f'{name.upper()}_ROW_{row:03}'
                cells = [f'<c r="A{row}" t="inlineStr"><is><t>{escape(label)}</t></is></c>', f'<c r="B{row}"><v>{row}</v></c>']
                if row == 1:
                    cells.append(f'<c r="F1" t="inlineStr"><is><t>{name.upper()}_OUTSIDE_PRINT_AREA</t></is></c>')
                data.append(f'<row r="{row}" ht="22" customHeight="1">{"".join(cells)}</row>')
            breaks = '<rowBreaks count="2" manualBreakCount="2"><brk id="30" min="0" max="16383" man="1"/><brk id="60" min="0" max="16383" man="1"/></rowBreaks>' if name == 'Detail' else ''
            archive.writestr(f'xl/worksheets/sheet{index}.xml', f'<worksheet xmlns="{NS}"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="35" customWidth="1"/><col min="2" max="3" width="15" customWidth="1"/></cols><sheetData>{"".join(data)}</sheetData><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" scale="100"/>{breaks}</worksheet>')
        archive.writestr('[Content_Types].xml', f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{"".join(types)}</Types>')
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('xl/workbook.xml', f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>{"".join(tabs)}</sheets><definedNames>{"".join(names)}</definedNames></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{"".join(relationships)}</Relationships>')


def verify_pdf(path):
    """Require every visible row, repeated headings, and no nonprinting markers."""
    from pypdf import PdfReader
    pages = [page.extract_text() or '' for page in PdfReader(path).pages]
    text = '\n'.join(pages)
    assert 'COVER_REPEATED_TITLE' in pages[0], 'first visible sheet missing'
    for prefix, count in [('COVER', 8), ('DETAIL', 90)]:
        for row in range(2, count + 1):
            marker = f'{prefix}_ROW_{row:03}'
            assert text.count(marker) == 1, f'{marker} missing or duplicated'
    detail_pages = [text for text in pages if 'DETAIL_ROW_' in text]
    assert len(detail_pages) >= 3, 'multi-page detail was not preserved'
    assert all('DETAIL_REPEATED_TITLE' in text for text in detail_pages), 'repeated print title missing'
    assert not any('COVER_ROW_' in text for text in detail_pages), 'visible sheets merged onto one page'
    assert 'HIDDEN_' not in text, 'hidden sheet printed'
    assert 'OUTSIDE_PRINT_AREA' not in text, 'print area ignored'
    return len(pages)


def main():
    """Run real Excel only after explicit opt-in, with a read-only private copy."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-native', action='store_true', help='explicitly allow opening native Excel for this synthetic test')
    parser.add_argument('--backend', type=Path, default=REPO / 'excel.applescript')
    parser.add_argument('--fixture-only', type=Path, help='write only a synthetic fixture and do not launch Excel')
    args = parser.parse_args()
    if args.fixture_only:
        make_fixture(args.fixture_only)
        print(args.fixture_only)
        return
    if not args.run_native:
        parser.error('native Excel was not requested; pass --run-native')
    container = Path.home() / 'Library/Containers/com.microsoft.Excel/Data/tmp'
    if not container.is_dir():
        parser.error('Excel container is unavailable; run Excel initial setup first')
    with tempfile.TemporaryDirectory(prefix='FinderPDFConverterQA-', dir=container) as directory:
        root = Path(directory)
        source, pdf = root / 'synthetic.xlsx', root / 'synthetic.pdf'
        make_fixture(source)
        before = source.read_bytes()
        source.chmod(0o400)
        subprocess.run(['/usr/bin/osascript', str(args.backend.resolve()), str(source), str(pdf)], check=True, timeout=200)
        assert source.read_bytes() == before, 'input workbook changed'
        pages = verify_pdf(pdf)
        print(f'PASS: native Excel exported {pages} pages; visible sheets, all rows, repeat titles, hidden sheet and print-area scope verified')


if __name__ == '__main__':
    main()

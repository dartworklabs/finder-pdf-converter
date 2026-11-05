"""Exercise the native host protocol with a harmless stub in private sessions."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
source = (repo / 'print-panel.js').read_text()
if os.environ.get('FPDF_MUTATE_HOST') == '1':
    source = source.replace("panelResult(request.resultPath, outcome);", "panelResult(request.resultPath, 'completed');")
with tempfile.TemporaryDirectory(prefix='fpdf-print.', dir='/private/tmp') as root_name:
    root = Path(root_name)
    os.chmod(root, 0o700)
    selection = root / 'selection.json'
    pdf = root / '0' / 'fixture.pdf'
    pdf.parent.mkdir()
    selection.write_text('{}')
    pdf.write_bytes(b'fixture')
    result = root / 'print-result.json'
    manifest = root / 'print-manifest.json'
    script = root / 'test.js'
    def stub(body):
        """Supply a harmless print adapter without invoking the native panel."""
        script.write_text("ObjC.import('Foundation'); ObjC.import('AppKit');\n" + source + "\nfunction printFitRun(args) { " + body + " }\nfunction run(argv) { printPanelAppRun(argv); }\n")

    stub("return 'cancelled';")

    def invoke(value):
        """Run the host without a print system and return any result it wrote."""
        result.unlink(missing_ok=True)
        manifest.write_text(json.dumps(value))
        proc = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(script), '--manifest', str(manifest)], timeout=10, capture_output=True)
        return json.loads(result.read_text()) if result.exists() else None

    valid = {'version': 1, 'selectionPath': str(selection), 'resultPath': str(result), 'pdfs': [str(pdf)]}
    assert invoke(valid) == {'version': 1, 'status': 'cancelled'}, 'valid request must propagate cancellation'
    stub("return 'completed';")
    assert invoke(valid) == {'version': 1, 'status': 'completed'}, 'completed operation must be reported'
    stub("throw Error('fixture failure');")
    assert invoke(valid) == {'version': 1, 'status': 'error'}, 'operation failures must be reported'
    stub("return 'cancelled';")
    for bad in [dict(valid, version=2), dict(valid, pdfs=[]), dict(valid, selectionPath='/etc/passwd'), dict(valid, resultPath=str(root / 'other'))]:
        assert invoke(bad) is None, 'malformed requests must not create a result or open a panel'
    pdf.unlink()
    pdf.symlink_to('/etc/passwd')
    assert invoke(valid) is None, 'linked inputs must be rejected'
    print('print panel protocol passed')

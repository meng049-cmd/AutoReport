"""Wait for the built version, rather than accepting a stale successful HTTP response."""
import re
import time
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

expected = re.search(r'assets/app\.js\?v=([a-f0-9]+)', Path('dist/index.html').read_text()).group(1)
url = 'https://meng049-cmd.github.io/AutoReport/?v=' + expected
for attempt in range(60):
    try:
        with urlopen(url, timeout=30) as response:
            html = response.read().decode('utf-8')
        if f'assets/app.js?v={expected}' in html and 'id="mergeDirect"' in html and 'id="yieldCalculate"' in html and 'id="qualityDashboard"' in html:
            print('Verified deployed website version:', expected)
            break
    except (URLError, TimeoutError) as error:
        print('Waiting for Pages:', type(error).__name__)
    time.sleep(5)
else:
    raise SystemExit('GitHub Pages has not deployed the expected website version.')

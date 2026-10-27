#!/usr/bin/env python3
"""把 sqlite / pdf / docx / html 转成纯文本，供插件导入知识库用。"""
import sys, os, json, zipfile, re

def wsl(p):
    p = p.replace('\\', '/')
    if len(p) > 2 and p[1] == ':':
        return '/mnt/' + p[0].lower() + p[2:]
    return p

def do_sqlite(path):
    import sqlite3
    con = sqlite3.connect(path)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    tables = [r[0] for r in cur.fetchall()]
    out = []
    for t in tables:
        try:
            cur.execute('SELECT * FROM "%s" LIMIT 500' % t.replace('"', '""'))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
        except Exception as e:
            out.append('## %s\n（读取失败：%s）' % (t, e)); continue
        out.append('## %s（%d 行）' % (t, len(rows)))
        for r in rows:
            kv = ['%s: %s' % (cols[i], r[i]) for i in range(len(cols)) if r[i] not in (None, '')]
            if kv: out.append('；'.join(kv))
        out.append('')
    con.close()
    return '\n'.join(out)

def do_docx(path):
    try:
        from docx import Document  # 有 python-docx 就用
        d = Document(path)
        return '\n'.join(p.text for p in d.paragraphs if p.text.strip())
    except Exception:
        pass
    # 退路：docx 就是 zip，直接抠 word/document.xml
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8', 'ignore')
    paras = re.findall(r'<w:p[ >].*?</w:p>', xml, re.S)
    out = []
    for p in paras:
        texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, re.S)
        line = ''.join(texts).strip()
        if line: out.append(line)
    return '\n'.join(out)

def do_pdf(path):
    try:
        from pypdf import PdfReader
    except Exception:
        try:
            from PyPDF2 import PdfReader
        except Exception:
            raise SystemExit('NEED_PYPDF')
    r = PdfReader(path)
    out = []
    for i, page in enumerate(r.pages[:100]):
        try: out.append(page.extract_text() or '')
        except Exception: out.append('')
    return '\n'.join(out)

def do_html(path):
    raw = open(path, 'r', encoding='utf-8', errors='ignore').read()
    raw = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', raw)
    raw = re.sub(r'(?s)<[^>]+>', ' ', raw)
    return re.sub(r'[ \t]+', ' ', raw)

def main():
    mode, src = sys.argv[1], wsl(sys.argv[2])
    if not os.path.exists(src):
        print('ERR: 文件不存在 ' + src); return 2
    try:
        if mode == 'sqlite': text = do_sqlite(src)
        elif mode == 'docx': text = do_docx(src)
        elif mode == 'pdf': text = do_pdf(src)
        elif mode == 'html': text = do_html(src)
        else: print('ERR: 未知模式 ' + mode); return 2
    except SystemExit as e:
        print(str(e)); return 3
    except Exception as e:
        print('ERR: ' + str(e)[:200]); return 4
    sys.stdout.write(text[:400000])
    return 0

if __name__ == '__main__':
    sys.exit(main())

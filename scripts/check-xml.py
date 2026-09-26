#!/usr/bin/env python3
"""Spread Helper XML denetimi (CEP manifestin geçerli XML olması ŞART — v0.3.0/0.3.1'de yorumdaki "--" yüzünden değildi):
  1) cep-helper/CSXS/manifest.xml ve cep-helper/.debug iyi biçimli XML (expat)
  2) manifest: ExtensionList'teki Extension Id = DispatchInfoList'teki Id = .debug'daki Id; Host PPRO; CSXS 12.0;
     UI Type Panel + Menu; MainPath / ScriptPath dosyaları var; ExtensionBundleVersion = helper.js VERSION
Kullanım: python3 scripts/check-xml.py [klasör]  (varsayılan cep-helper)
"""
import os, re, sys
import xml.dom.minidom as minidom

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "cep-helper")
bad = []

def parse(rel):
    path = os.path.join(root, rel)
    try:
        return minidom.parse(path)
    except Exception as e:  # expat hatası: satır/sütun içerir
        bad.append(f"{rel}: iyi biçimli XML DEĞİL — {e}")
        return None

m = parse("CSXS/manifest.xml")
d = parse(".debug")
if m:
    em = m.documentElement
    bundle = em.getAttribute("ExtensionBundleId")
    ver = em.getAttribute("ExtensionBundleVersion")
    ids = [e.getAttribute("Id") for e in em.getElementsByTagName("ExtensionList")[0].getElementsByTagName("Extension")]
    disp = [e.getAttribute("Id") for e in em.getElementsByTagName("DispatchInfoList")[0].getElementsByTagName("Extension")]
    if len(ids) != 1 or ids != disp:
        bad.append(f"manifest: ExtensionList Id {ids} ≠ DispatchInfoList Id {disp}")
    if not ids or not ids[0].startswith(bundle + "."):
        bad.append(f"manifest: Extension Id {ids} ExtensionBundleId '{bundle}' ile başlamıyor")
    hosts = [(h.getAttribute("Name"), h.getAttribute("Version")) for h in em.getElementsByTagName("Host")]
    if not any(n == "PPRO" for n, _ in hosts):
        bad.append(f"manifest: PPRO host yok {hosts}")
    rt = [(r.getAttribute("Name"), r.getAttribute("Version")) for r in em.getElementsByTagName("RequiredRuntime")]
    if ("CSXS", "12.0") not in rt:
        bad.append(f"manifest: CSXS 12.0 yok {rt}")
    typ = [t.firstChild.data.strip() for t in em.getElementsByTagName("Type") if t.firstChild]
    menu = [t.firstChild.data.strip() for t in em.getElementsByTagName("Menu") if t.firstChild]
    if typ != ["Panel"] or not menu:
        bad.append(f"manifest: UI Type {typ} / Menu {menu} (görünür panel bekleniyor)")
    for tag in ("MainPath", "ScriptPath"):
        for t in em.getElementsByTagName(tag):
            f = t.firstChild.data.strip()
            if not os.path.isfile(os.path.join(root, f)):
                bad.append(f"manifest: {tag} {f} dosyası yok")
    hj = os.path.join(root, "js", "helper.js")
    if os.path.isfile(hj):
        mv = re.search(r'var VERSION = "([^"]+)"', open(hj, encoding="utf8").read())
        if not mv or mv.group(1) != ver:
            bad.append(f"manifest ExtensionBundleVersion {ver} ≠ helper.js VERSION {mv.group(1) if mv else '?'}")
    if d:
        did = [e.getAttribute("Id") for e in d.documentElement.getElementsByTagName("Extension")]
        dh = [(h.getAttribute("Name"), h.getAttribute("Port")) for h in d.documentElement.getElementsByTagName("Host")]
        if did != ids:
            bad.append(f".debug Id {did} ≠ manifest Extension Id {ids}")
        if not dh or dh[0][0] != "PPRO" or not dh[0][1].isdigit() or not (1024 <= int(dh[0][1]) <= 65535):
            bad.append(f".debug host/port geçersiz {dh}")

for b in bad:
    print("✗ " + b)
print(f"yardımcı XML: {'SORUNLU (' + str(len(bad)) + ')' if bad else 'manifest.xml + .debug iyi biçimli, kimlikler tutarlı'}")
sys.exit(1 if bad else 0)

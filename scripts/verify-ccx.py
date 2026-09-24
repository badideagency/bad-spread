#!/usr/bin/env python3
"""release/spread-probe.ccx'i açıp kontrol eder: kökte manifest.json, izinler 644/755, alt klasör sarmalı yok."""
import json
import stat
import sys
import zipfile

path = sys.argv[1] if len(sys.argv) > 1 else "release/spread-probe.ccx"
errors = []
with zipfile.ZipFile(path) as z:
    infos = z.infolist()
    names = [i.filename for i in infos]
    print(f"{path}: {len(infos)} girdi")
    print(f"{'izin':>6}  {'sistem':>6}  {'boyut':>7}  ad")
    for i in infos:
        mode = (i.external_attr >> 16) & 0o177777
        perm = stat.S_IMODE(mode)
        is_dir = i.filename.endswith("/")
        sysname = {0: "DOS", 3: "Unix"}.get(i.create_system, str(i.create_system))
        print(f"{perm:>6o}  {sysname:>6}  {i.file_size:>7}  {i.filename}")
        if i.create_system != 3:
            errors.append(f"{i.filename}: Unix izin bilgisi yok (create_system={i.create_system})")
        want = 0o755 if is_dir else 0o644
        if perm != want:
            errors.append(f"{i.filename}: izin {perm:o}, beklenen {want:o}")
        if i.filename.startswith("/") or ".." in i.filename.split("/"):
            errors.append(f"{i.filename}: güvensiz yol")
    if "manifest.json" not in names:
        errors.append("kökte manifest.json YOK")
    else:
        m = json.loads(z.read("manifest.json"))
        print(f"manifest: id={m.get('id')} version={m.get('version')} host={m.get('host')} "
              f"manifestVersion={m.get('manifestVersion')} perms={m.get('requiredPermissions')}")
        if m.get("host", {}).get("app") != "premierepro":
            errors.append("manifest host.app premierepro değil")
        if m.get("manifestVersion") != 5:
            errors.append("manifestVersion 5 değil")
        main = m.get("main", "index.html")
        for need in [main, "index.js"]:
            if need not in names:
                errors.append(f"kökte {need} yok")
        for ep in m.get("entrypoints", []):
            for ic in ep.get("icons", []):
                if ic["path"] not in names:
                    errors.append(f"ikon yok: {ic['path']}")
        for ic in m.get("icons", []):
            if ic["path"] not in names:
                errors.append(f"ikon yok: {ic['path']}")
    tops = sorted({n.split("/")[0] for n in names})
    print(f"kökteki öğeler: {tops}")
    bad = z.testzip()
    if bad:
        errors.append(f"bozuk girdi: {bad}")

if errors:
    print("\nKONTROL BAŞARISIZ:")
    for e in errors:
        print(f"  ✗ {e}")
    sys.exit(1)
print("\nKONTROL OK: kökte manifest.json var, dosyalar 644, klasörler 755, zip sağlam.")

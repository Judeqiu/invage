"""Extract the approved demo layout without evaluating formulas.

Coordinates define the reviewed schema. Strategy prose never classifies a fill.
Usage: python3 scripts/extract-demo-workbook.py source.xlsx extracted.json
"""
import datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET
import zipfile

source_path, output_path = map(Path, sys.argv[1:])
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(source_path) as archive:
    strings = ["".join(e.itertext()) for e in
               ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", ns)]
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    sheet_names = [e.attrib["name"] for e in workbook.findall("s:sheets/s:sheet", ns)]
    broker_ids = ["moomoo", "ibkr", "tiger"]  # reviewed sheet-to-account mapping
    if len(sheet_names) != len(broker_ids) + 1:
        raise ValueError("Workbook differs from the approved sheet schema")
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {e.attrib["Id"]: e.attrib["Target"] for e in relationships}
    sheets, trees = [], []
    for sheet in workbook.findall("s:sheets/s:sheet", ns):
        target = targets[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
        part = target.lstrip("/") if target.startswith("/") else "xl/" + target
        tree = ET.fromstring(archive.read(part))
        cells = {}
        for cell in tree.findall(".//s:sheetData/s:row/s:c", ns):
            value = cell.find("s:v", ns)
            if value is not None:
                cells[cell.attrib["r"]] = strings[int(value.text)] if cell.attrib.get("t") == "s" else value.text
        sheets.append(cells)
        trees.append(tree)

number = lambda value: str(Decimal(value))
base = sheets[0]
parts = base["A1"].partition(":")[2].split()
as_of = datetime.date(int(parts[2]), time.strptime(parts[1], "%B").tm_mon,
                      int("".join(c for c in parts[0] if c.isdecimal()))).isoformat()
summary = {name: number(base[cell]) for name, cell in {
    "premiumDaily": "A3", "premiumMtd": "A5", "premiumTotal": "A8",
    "earnedMtd": "A14", "earnedTotal": "A16", "nav": "A19", "cash": "A22",
    "assignment": "A25", "riskCapital": "A28"}.items()}
summary.update(earnedDaily=None, feesMtd=number(base["A6"].rpartition("$")[2]),
               feesTotal=number(base["A9"].rpartition("$")[2]))
formula = trees[1].find(".//s:c[@r='K2']/s:f", ns).text
multiplier = number(formula.rpartition("*")[2].rstrip(")"))
properties = workbook.find("s:workbookPr", ns)
epoch = datetime.date(1904, 1, 1) if properties is not None and properties.attrib.get("date1904") == "1" else datetime.date(1899, 12, 30)
rows = []
for cells, sheet, broker in zip(sheets[1:], sheet_names[1:], broker_ids):
    coordinates = sorted({int("".join(c for c in ref if c.isdecimal())) for ref in cells})
    for row in coordinates:
        if row == 1 or f"F{row}" not in cells:
            continue
        get = lambda column: cells[f"{column}{row}"]
        date = lambda column: (epoch + datetime.timedelta(days=int(get(column)))).isoformat()
        rows.append(dict(sheet=sheet, row=row, channel=broker, brokerId=broker, underlying=get("B"),
                         description=get("C"), entryDate=date("A"), expiry=date("E"), strike=number(get("D")),
                         contracts=number(get("F")), credit=number(get("G")), debit=number(get("H")), fees=number(get("I"))))
source = dict(version=1, asOf=as_of, currency="USD", multiplier=multiplier, summary=summary, rows=rows,
              source=dict(sha256=hashlib.sha256(source_path.read_bytes()).hexdigest(),
                          fileId="imports/demo-workbook/Demo data.xlsx"))
output_path.write_text(json.dumps(source, indent=2) + "\n")
print(json.dumps(dict(asOf=as_of, rows=len(rows), channels=sorted({r["channel"] for r in rows}),
                      summary=summary, sha256=source["source"]["sha256"])))

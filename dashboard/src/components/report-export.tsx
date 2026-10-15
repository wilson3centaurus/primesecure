"use client";

import { Download } from "lucide-react";

type Cell = string | number | null;

// Quoting alone does not stop spreadsheet programs from evaluating formulas.
export function csvCell(value: Cell): string {
  let text = String(value ?? "");
  if (typeof value !== "number" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function ReportExport({ filename, columns, rows }: { filename: string; columns: string[]; rows: Cell[][] }) {
  function download() {
    const content = [columns, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={download} disabled={!rows.length}><Download size={15} />Export CSV</button>;
}

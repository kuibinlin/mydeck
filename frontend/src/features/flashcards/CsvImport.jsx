import { useState, useRef } from "react";
import { parseCSV, downloadCSV } from "@/lib/utils";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import PreviewModal from "@/components/ui/PreviewModal";

// CSV import flow for flashcard decks.
// columns: front | meaning | note (optional)
// onImport(cards): called with [{front, meaning, note}] after confirm
// currentCount: cards already in the deck; limit: max allowed — rows beyond the limit are auto-excluded
export default function CsvImport({ onImport, currentCount = 0, limit = Infinity }) {
  const [preview, setPreview] = useState(null); // [{front, meaning, note, _keep}]
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef();

  // How many more cards can be added. Infinity when no limit is set.
  const available = Number.isFinite(limit) ? Math.max(0, limit - currentCount) : Infinity;

  const downloadTemplate = () => {
    downloadCSV(
      "flashcard-template.csv",
      "# How to use: Replace the example row below with your own data.\n" +
        "# Columns: front | meaning | note (optional)\n" +
        "# Lines starting with # are ignored.\n" +
        "front,meaning,note\n" +
        '"car","a vehicle with four wheels",""\n',
    );
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    e.target.value = "";
    setError(null);

    const rows = parseCSV(text);
    if (rows.length < 2) {
      setError("CSV must have a header row and at least one data row.");
      return;
    }

    const header = rows[0].map((h) => h.toLowerCase());
    const frontIdx = header.indexOf("front");
    const meaningIdx = header.indexOf("meaning");
    const noteIdx = header.indexOf("note");

    if (frontIdx === -1 || meaningIdx === -1) {
      setError('CSV must have "front" and "meaning" columns.');
      return;
    }

    const cards = rows
      .slice(1)
      .map((r, i) => ({
        front: r[frontIdx] || "",
        meaning: r[meaningIdx] || "",
        note: noteIdx !== -1 ? r[noteIdx] || "" : "",
        _keep: i < available,
      }))
      .filter((c) => c.front && c.meaning);

    if (cards.length === 0) {
      setError("No valid cards found in CSV.");
      return;
    }

    setPreview(cards);
  };

  const handleConfirm = async () => {
    setImporting(true);
    try {
      await onImport(preview.filter((c) => c._keep));
    } finally {
      setImporting(false);
      setPreview(null);
    }
  };

  const toggleRow = (i) => {
    setPreview((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, _keep: !c._keep } : c)),
    );
  };

  const kept = preview ? preview.filter((c) => c._keep).length : 0;
  const initExcluded = preview && Number.isFinite(available) ? Math.max(0, preview.length - available) : 0;
  const overLimit = preview && Number.isFinite(available) ? Math.max(0, kept - available) : 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={downloadTemplate}>
        <i className="fas fa-download" /> CSV Template
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          inputRef.current?.click();
        }}
      >
        <i className="fas fa-file-import" /> Import CSV
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFile}
      />

      {error && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={() => setError(null)}>
          <div className="bg-surface rounded-card shadow-[0_8px_32px_rgb(0_0_0/0.2)] w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <Alert>{error}</Alert>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setError(null)}>Close</Button>
          </div>
        </div>
      )}

      {preview && (
        <PreviewModal
          title={`Import Preview — ${kept} of ${preview.length} cards`}
          hint="You can edit individual cards after importing if anything looks off."
          onClose={() => setPreview(null)}
          confirmLabel={<><i className="fas fa-check" /> Confirm Import</>}
          confirming={importing}
          confirmingLabel="Importing…"
          onConfirm={handleConfirm}
        >
          {(initExcluded > 0 || overLimit > 0) && (
            <div className={`mx-5 mt-4 flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${
              overLimit > 0
                ? "border-error/30 bg-error/10 text-error"
                : "border-warning/30 bg-warning/10 text-warning"
            }`}>
              <i className={`fas mt-0.5 shrink-0 ${overLimit > 0 ? "fa-circle-xmark" : "fa-triangle-exclamation"}`} />
              <span>
                {overLimit > 0
                  ? `${overLimit} row${overLimit !== 1 ? "s" : ""} over the ${limit}-card limit — ${overLimit > 1 ? "they" : "it"} will be skipped on import.`
                  : `${initExcluded} row${initExcluded !== 1 ? "s" : ""} auto-excluded — deck limit is ${limit}${currentCount > 0 ? ` (${currentCount} already added)` : ""}.`
                }
              </span>
            </div>
          )}
          <div className="px-5 py-3">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="px-2 py-1.5 text-left font-semibold">Front</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Meaning</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Note</th>
                  <th className="px-2 py-1.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {preview.map((c, i) => (
                  <tr
                    key={i}
                    className="border-b border-border transition-opacity"
                    style={{ opacity: c._keep ? 1 : 0.35 }}
                  >
                    <td className="px-2 py-2">{c.front}</td>
                    <td className="px-2 py-2">{c.meaning}</td>
                    <td className="px-2 py-2 text-muted">{c.note}</td>
                    <td className="px-2 py-2 text-center">
                      <button
                        className="inline-flex items-center justify-center w-6 h-6 bg-transparent border-0 cursor-pointer rounded transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        onClick={() => toggleRow(i)}
                        title={c._keep ? "Exclude row" : "Include row"}
                      >
                        <i
                          className={`fas ${c._keep ? "fa-times text-error" : "fa-undo text-muted"}`}
                          style={{ fontSize: 11 }}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PreviewModal>
      )}
    </>
  );
}

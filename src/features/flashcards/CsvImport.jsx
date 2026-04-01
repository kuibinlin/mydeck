import { useState, useRef } from "react";
import { parseCSV, downloadCSV } from "@/lib/utils";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import PreviewModal from "@/components/ui/PreviewModal";

// CSV import flow for flashcard decks.
// columns: front | meaning | note (optional)
// onImport(cards): called with [{front, meaning, note}] after confirm
export default function CsvImport({ onImport }) {
  const [preview, setPreview] = useState(null); // [{front, meaning, note, _keep}]
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef();

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
      .map((r) => ({
        front: r[frontIdx] || "",
        meaning: r[meaningIdx] || "",
        note: noteIdx !== -1 ? r[noteIdx] || "" : "",
        _keep: true,
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

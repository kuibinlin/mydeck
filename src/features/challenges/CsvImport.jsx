import { useState, useRef } from "react";
import { parseCSV, downloadCSV } from "@/lib/utils";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import PreviewModal from "@/components/ui/PreviewModal";

// CSV import for challenges.
// columns: question | choice_a | choice_b | choice_c | choice_d | answer (A/B/C/D)
// onImport(questions): called with [{question, choices, answer}] after confirm
// currentCount: questions already in the deck; limit: max allowed — rows beyond the limit are auto-excluded
export default function CsvImport({ onImport, currentCount = 0, limit = Infinity }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef();

  // How many more questions can be added. Infinity when no limit is set.
  const available = Number.isFinite(limit) ? Math.max(0, limit - currentCount) : Infinity;

  const downloadTemplate = () => {
    downloadCSV(
      "challenge-template.csv",
      "# How to use: Replace the example row below with your own questions.\n" +
        "# Columns: question | choice_a | choice_b | choice_c | choice_d | answer\n" +
        "# The answer column must be A or B or C or D.\n" +
        "# Lines starting with # are ignored.\n" +
        "question,choice_a,choice_b,choice_c,choice_d,answer\n" +
        '"What has four wheels?","Bicycle","Car","Tricycle","Scooter","B"\n',
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

    const header = rows[0].map((h) => h.toLowerCase().replace(/\s/g, "_"));
    const qIdx = header.indexOf("question");
    const aIdx = header.indexOf("choice_a");
    const bIdx = header.indexOf("choice_b");
    const cIdx = header.indexOf("choice_c");
    const dIdx = header.indexOf("choice_d");
    const ansIdx = header.indexOf("answer");

    if ([qIdx, aIdx, bIdx, cIdx, dIdx, ansIdx].includes(-1)) {
      setError(
        "CSV must have columns: question, choice_a, choice_b, choice_c, choice_d, answer",
      );
      return;
    }

    const answerMap = { A: 0, B: 1, C: 2, D: 3, 0: 0, 1: 1, 2: 2, 3: 3 };
    const questions = rows
      .slice(1)
      .map((r, i) => {
        const ans = (r[ansIdx] || "").toUpperCase();
        return {
          question: r[qIdx] || "",
          choices: [r[aIdx] || "", r[bIdx] || "", r[cIdx] || "", r[dIdx] || ""],
          answer: answerMap[ans] !== undefined ? answerMap[ans] : -1,
          _keep: i < available,
        };
      })
      .filter(
        (q) => q.question && q.choices.every((c) => c) && q.answer !== -1,
      );

    if (questions.length === 0) {
      setError(
        "No valid questions found. Check that answer column uses A, B, C, or D.",
      );
      return;
    }

    setPreview(questions);
  };

  const handleConfirm = async () => {
    setImporting(true);
    try {
      await onImport(preview.filter((q) => q._keep));
    } finally {
      setImporting(false);
      setPreview(null);
    }
  };

  const toggleRow = (i) => {
    setPreview((prev) =>
      prev.map((q, idx) => (idx === i ? { ...q, _keep: !q._keep } : q)),
    );
  };

  const LABELS = ["A", "B", "C", "D"];
  const kept = preview ? preview.filter((q) => q._keep).length : 0;
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
          title={`Import Preview — ${kept} of ${preview.length} questions`}
          hint="You can edit individual questions after importing if anything looks off."
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
                  ? `${overLimit} row${overLimit !== 1 ? "s" : ""} over the ${limit}-question limit — ${overLimit > 1 ? "they" : "it"} will be skipped on import.`
                  : `${initExcluded} row${initExcluded !== 1 ? "s" : ""} auto-excluded — deck limit is ${limit}${currentCount > 0 ? ` (${currentCount} already added)` : ""}.`
                }
              </span>
            </div>
          )}
          <div className="px-5 py-4 flex flex-col gap-3">
            {preview.map((q, i) => (
              <div
                key={i}
                className="border border-border rounded-card p-4 transition-opacity"
                style={{ opacity: q._keep ? 1 : 0.35 }}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted">Q{i + 1}</span>
                    <p className="text-sm font-semibold">{q.question}</p>
                  </div>
                  <button
                    className="shrink-0 inline-flex items-center justify-center w-6 h-6 bg-transparent border-0 cursor-pointer rounded transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    onClick={() => toggleRow(i)}
                    title={q._keep ? "Exclude this question" : "Include this question"}
                  >
                    <i
                      className={`fas text-xs ${q._keep ? "fa-times text-error" : "fa-undo text-muted"}`}
                    />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                  {q.choices.map((choice, ci) => {
                    const isCorrect = ci === q.answer;
                    return (
                      <div
                        key={ci}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm border ${
                          isCorrect
                            ? "bg-success/10 border-success/30 text-success font-semibold"
                            : "bg-black/[0.03] dark:bg-white/[0.03] border-transparent text-text"
                        }`}
                      >
                        <span
                          className={`text-xs font-bold w-4 shrink-0 ${isCorrect ? "text-success" : "text-muted"}`}
                        >
                          {LABELS[ci]}
                        </span>
                        <span className="flex-1 leading-snug">{choice}</span>
                        {isCorrect && (
                          <i
                            className="fas fa-check text-success shrink-0"
                            style={{ fontSize: 11 }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </PreviewModal>
      )}
    </>
  );
}

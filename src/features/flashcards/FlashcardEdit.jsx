import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import Spinner from "@/components/ui/Spinner";
import Modal from "@/components/ui/Modal";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import PreviewModal from "@/components/ui/PreviewModal";
import { CATEGORIES, DEFAULT_CATEGORY } from "@/lib/constants";
import { generateFlashcards } from "@/lib/aiApi";
import FlashcardCardForm from "./FlashcardCardForm";
import CsvImport from "./CsvImport";
import {
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  addCard,
  updateCard,
  deleteCard,
} from "./flashcardApi";

export default function FlashcardEdit() {
  const { id } = useParams(); // undefined when creating
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [deckId, setDeckId] = useState(id || null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [description, setDescription] = useState("");
  const [cards, setCards] = useState([]);
  const [showCardForm, setShowCardForm] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deckSaved, setDeckSaved] = useState(isEdit);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDeleteCardId, setPendingDeleteCardId] = useState(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiArticle, setAiArticle] = useState("");
  const [aiCount, setAiCount] = useState(5);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiPreview, setAiPreview] = useState(null);
  const [aiFrontHint, setAiFrontHint] = useState("");
  const [aiMeaningHint, setAiMeaningHint] = useState("");
  const [aiNoteHint, setAiNoteHint] = useState("");
  const aiAbortRef = useRef(null);

  useEffect(() => {
    if (!isEdit) return;
    getDeck(id)
      .then((data) => {
        setTitle(data.deck.title);
        setCategory(data.deck.category);
        setDescription(data.deck.description || "");
        setCards(data.cards);
      })
      .catch((err) => {
        setMsg({ type: "error", text: err.message });
        navigate("/flashcards");
      })
      .finally(() => setLoading(false));
  }, [id, isEdit, navigate]);

  const refreshCards = () =>
    getDeck(deckId)
      .then((data) => setCards(data.cards))
      .catch(() => {});

  const handleSaveDeck = async () => {
    if (!title.trim()) {
      setMsg({ type: "error", text: "Title is required" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      if (deckId) {
        await updateDeck(deckId, { title, category, description });
        setMsg({ type: "success", text: "Deck updated!" });
      } else {
        const data = await createDeck({ title, category, description });
        setDeckId(data.id);
        setDeckSaved(true);
        setMsg({ type: "success", text: "Deck created! Now add cards below." });
      }
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCard = async (front, meaning, note) => {
    try {
      await addCard(deckId, { front, meaning, note });
      setShowCardForm(false);
      refreshCards();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  };

  const handleUpdateCard = async (front, meaning, note) => {
    try {
      await updateCard(editingCard.id, { front, meaning, note });
      setEditingCard(null);
      refreshCards();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  };

  const handleDeleteCard = async () => {
    try {
      await deleteCard(pendingDeleteCardId);
      setPendingDeleteCardId(null);
      refreshCards();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
      setPendingDeleteCardId(null);
    }
  };

  const handleDeleteDeck = async () => {
    try {
      await deleteDeck(deckId);
      navigate("/flashcards");
    } catch (err) {
      setMsg({ type: "error", text: err.message });
      setShowDeleteModal(false);
    }
  };

  const handleCsvImport = async (importedCards) => {
    for (const c of importedCards) {
      try {
        await addCard(deckId, {
          front: c.front,
          meaning: c.meaning,
          note: c.note || null,
        });
      } catch {
        /* skip invalid rows */
      }
    }
    refreshCards();
  };

  const handleAIGenerate = async () => {
    if (!aiArticle.trim()) {
      setAiError("Paste an article first");
      return;
    }
    if (!deckSaved || !deckId) {
      setAiError("Save the deck first before generating AI cards");
      return;
    }
    setAiGenerating(true);
    setAiError(null);
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      const payload = { article: aiArticle, count: aiCount };
      if (aiFrontHint.trim()) payload.frontHint = aiFrontHint.trim();
      if (aiMeaningHint.trim()) payload.meaningHint = aiMeaningHint.trim();
      if (aiNoteHint.trim()) payload.noteHint = aiNoteHint.trim();
      const data = await generateFlashcards(payload, controller.signal);
      setAiPreview(data.cards.map((c) => ({ ...c, _keep: true })));
    } catch (err) {
      if (err.name === "AbortError") return;
      setAiError(err.message);
    } finally {
      setAiGenerating(false);
      aiAbortRef.current = null;
    }
  };

  const handleAIConfirm = async () => {
    const kept = aiPreview.filter((c) => c._keep);
    let added = 0;
    try {
      for (const card of kept) {
        await addCard(deckId, {
          front: card.front,
          meaning: card.meaning,
          note: card.note || null,
        });
        added++;
      }
    } catch (err) {
      setMsg({
        type: "error",
        text: `Added ${added}/${kept.length} cards. Error: ${err.message}`,
      });
    }
    refreshCards();
    setAiPreview(null);
    setAiArticle("");
    setShowAIPanel(false);
    if (added === kept.length) {
      setMsg({
        type: "success",
        text: `${kept.length} cards generated with AI!`,
      });
    }
  };

  const handleAICancel = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiGenerating(false);
  };

  if (loading) return <Spinner center />;

  return (
    <div>
      <BackButton onClick={() => navigate("/flashcards")} />

      <h2 className="text-xl font-bold mb-4">
        {isEdit ? "Edit Flashcards" : "Create Flashcards"}
      </h2>

      {msg && <Alert variant={msg.type}>{msg.text}</Alert>}

      {/* Deck metadata */}
      <div className="bg-surface rounded-card shadow-card p-5 mb-4">
        <div className="flex gap-3 mb-4">
          <Input
            label="Deck Title"
            type="text"
            placeholder="e.g. Japanese N5 Basics"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            wrapperClassName="flex-1"
          />
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            wrapperClassName="flex-1"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <Input
          label="Description (optional)"
          type="text"
          placeholder="What is this deck about?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <Button onClick={handleSaveDeck} disabled={saving}>
            {isEdit ? (
              <><i className="fas fa-save" /> Update</>
            ) : (
              <><i className="fas fa-check" /> Confirm</>
            )}
          </Button>
          {isEdit && (
            <Button
              variant="dangerOutline"
              onClick={() => setShowDeleteModal(true)}
            >
              <i className="fas fa-trash" /> Delete Deck
            </Button>
          )}
        </div>
      </div>

      {/* Cards section — header always visible so users see the full page shape.
           Action buttons and content are gated behind deckSaved (deck must exist
           in the DB before cards can be associated with it). */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold">Cards</h2>
        {deckSaved && (
          <div className="grid grid-cols-2 sm:flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setEditingCard(null);
                setShowCardForm(true);
              }}
            >
              <i className="fas fa-plus" /> Add Card
            </Button>
            <Button
              variant="ai"
              size="sm"
              onClick={() => setShowAIPanel(!showAIPanel)}
            >
              <i className="fas fa-wand-magic-sparkles" /> AI Generate
            </Button>
            <CsvImport onImport={handleCsvImport} />
          </div>
        )}
      </div>

      {!deckSaved ? (
        <div className="rounded-card border border-primary/25 bg-primary/8 py-12 px-6 text-center">
          <i className="fas fa-circle-info text-4xl max-md:text-3xl mb-4 block text-primary" />
          <p className="text-base max-md:text-sm font-semibold text-primary">
            Save the deck details above to start adding cards.
          </p>
        </div>
      ) : (
        <>
          {showAIPanel && (
            <div className="bg-surface rounded-card shadow-card p-5 mb-4 border border-purple-300 dark:border-purple-800">
              <h3 className="text-base font-semibold mb-2">
                <i className="fas fa-wand-magic-sparkles text-purple-500 mr-1.5" />
                AI Flashcard Generator
              </h3>
              <p className="text-sm text-muted mb-3">
                Paste an article or text and AI will generate flashcards from
                it.
              </p>
              {aiError && <Alert className="mb-3">{aiError}</Alert>}
              <Textarea
                label="Article / Text"
                placeholder="Paste your article or text here..."
                value={aiArticle}
                onChange={(e) => setAiArticle(e.target.value)}
                rows={6}
                maxLength={10000}
                disabled={aiGenerating}
              />
              <div className="text-xs text-muted -mt-3 mb-3 text-right">
                {aiArticle.length}/10,000
              </div>
              <div className="mb-3">
                <label className="block text-sm font-semibold mb-1.5 text-text">
                  Number of cards
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={aiCount}
                  onChange={(e) => setAiCount(parseInt(e.target.value) || 1)}
                  disabled={aiGenerating}
                  className="w-20 px-2 py-1 text-sm font-semibold text-center bg-surface border-2 border-primary/40 ring-2 ring-primary/20 rounded-lg focus:border-primary focus:ring-primary/30"
                />
              </div>
              <div className="mb-3">
                <label className="block text-sm font-semibold mb-1.5 text-text">
                  Custom instructions{" "}
                  <span className="font-normal text-muted">(optional)</span>
                </label>
                <p className="text-xs text-muted mb-2">
                  Tell AI what to put in each field. Leave empty for defaults.
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-muted mb-0.5">
                      Front
                    </label>
                    <input
                      type="text"
                      placeholder='e.g. "The word in Chinese" or "English vocabulary from the article"'
                      value={aiFrontHint}
                      onChange={(e) => setAiFrontHint(e.target.value)}
                      disabled={aiGenerating}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-0.5">
                      Meaning
                    </label>
                    <input
                      type="text"
                      placeholder='e.g. "Explanation in Chinese" or "Definition in both English and Chinese"'
                      value={aiMeaningHint}
                      onChange={(e) => setAiMeaningHint(e.target.value)}
                      disabled={aiGenerating}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted mb-0.5">
                      Note
                    </label>
                    <input
                      type="text"
                      placeholder='e.g. "Example sentences using this word"'
                      value={aiNoteHint}
                      onChange={(e) => setAiNoteHint(e.target.value)}
                      disabled={aiGenerating}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {aiGenerating ? (
                  <>
                    <Button variant="ai" disabled>
                      <i className="fas fa-spinner fa-spin" /> Generating…
                    </Button>
                    <Button variant="ghost" onClick={handleAICancel}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ai"
                    onClick={handleAIGenerate}
                    disabled={!!aiPreview}
                  >
                    <i className="fas fa-wand-magic-sparkles" /> Generate
                  </Button>
                )}
              </div>
            </div>
          )}

          {aiPreview && (
            <PreviewModal
              title={`AI Preview — ${aiPreview.filter((c) => c._keep).length} of ${aiPreview.length} cards`}
              hint="You can edit individual cards after adding if anything looks off."
              onClose={() => setAiPreview(null)}
              confirmLabel={
                <><i className="fas fa-check" /> Add {aiPreview.filter((c) => c._keep).length} Cards</>
              }
              onConfirm={handleAIConfirm}
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
                    {aiPreview.map((c, i) => (
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
                            onClick={() =>
                              setAiPreview((prev) =>
                                prev.map((p, idx) =>
                                  idx === i ? { ...p, _keep: !p._keep } : p,
                                ),
                              )
                            }
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

          {showCardForm && (
            <FlashcardCardForm
              onSave={handleSaveCard}
              onCancel={() => setShowCardForm(false)}
            />
          )}

          {cards.length === 0 && !showCardForm && (
            <div className="text-center py-16 px-5 text-muted">
              <i className="fas fa-plus-circle text-5xl mb-3 block" />
              <p>No cards yet. Add your first card!</p>
            </div>
          )}

          {cards.map((c, i) =>
            editingCard?.id === c.id ? (
              <FlashcardCardForm
                key={c.id}
                initialValues={c}
                onSave={handleUpdateCard}
                onCancel={() => setEditingCard(null)}
              />
            ) : (
              <div
                key={c.id}
                className="bg-surface rounded-card shadow-card p-4 mb-3"
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-bold text-sm text-muted">
                    Card {i + 1}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowCardForm(false);
                        setEditingCard(c);
                      }}
                    >
                      <i className="fas fa-pencil-alt" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDeleteCardId(c.id)}
                    >
                      <i className="fas fa-trash text-error" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                  <div>
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">
                      Front
                    </div>
                    <div className="text-sm font-semibold">{c.front}</div>
                  </div>
                  <div className="border-l border-border pl-3 max-sm:border-l-0 max-sm:pl-0 max-sm:border-t max-sm:pt-3">
                    <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">
                      Back
                    </div>
                    <div className="text-sm">{c.meaning}</div>
                    {c.note && (
                      <div className="text-xs text-muted mt-2 pt-2 border-t border-border">
                        {c.note}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ),
          )}
        </>
      )}
      <Modal
        open={!!pendingDeleteCardId}
        title="Delete card?"
        message="This card will be permanently deleted."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteCard}
        onCancel={() => setPendingDeleteCardId(null)}
      />
      <Modal
        open={showDeleteModal}
        title="Delete deck?"
        message="This will permanently delete the deck and all its cards. This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteDeck}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import Spinner from "@/components/ui/Spinner";
import Modal from "@/components/ui/Modal";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import PreviewModal from "@/components/ui/PreviewModal";
import { CATEGORIES, DEFAULT_CATEGORY } from "@/lib/constants";
import {
  getDecks as getFcDecks,
  getDeck as getFcDeck,
} from "@/features/flashcards/flashcardApi";
import { generateVocab, generateComprehension } from "@/lib/aiApi";
import QuestionForm from "./QuestionForm";
import CsvImport from "./CsvImport";
import {
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  addCard,
  updateCard,
  deleteCard,
  publish,
} from "./challengeApi";

export default function ChallengeEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [deckId, setDeckId] = useState(id || null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [description, setDescription] = useState("");
  const [linkedFcId, setLinkedFcId] = useState("");
  const [fcDecks, setFcDecks] = useState([]);
  const [cards, setCards] = useState([]);
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [deckSaved, setDeckSaved] = useState(isEdit);
  const [isPublished, setIsPublished] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pendingDeleteCardId, setPendingDeleteCardId] = useState(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiMode, setAiMode] = useState("vocab-deck");
  const [aiArticle, setAiArticle] = useState("");
  const [aiCount, setAiCount] = useState(5);
  const [aiHint, setAiHint] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiPreview, setAiPreview] = useState(null);
  const aiAbortRef = useRef(null);

  useEffect(() => {
    // load flashcard decks for the link dropdown
    getFcDecks()
      .then((d) => setFcDecks(d.decks))
      .catch(() => {});

    if (!isEdit) return;
    getDeck(id)
      .then((data) => {
        setTitle(data.deck.title);
        setCategory(data.deck.category);
        setDescription(data.deck.description || "");
        if (data.linked_flashcard_decks?.length > 0) {
          setLinkedFcId(String(data.linked_flashcard_decks[0].id));
        }
        setCards(data.all_cards || []);
        setIsPublished(!!data.version);
      })
      .catch((err) => {
        setMsg({ type: "error", text: err.message });
        navigate("/challenges");
      })
      .finally(() => setLoading(false));
  }, [id, isEdit, navigate]);

  const refreshCards = () =>
    getDeck(deckId)
      .then((data) => setCards(data.all_cards || []))
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
        await updateDeck(deckId, {
          title,
          category,
          description,
          linked_flashcard_deck_id: linkedFcId || null,
        });
        setMsg({ type: "success", text: "Deck updated!" });
      } else {
        const data = await createDeck({
          title,
          category,
          description,
          linked_flashcard_deck_id: linkedFcId || null,
        });
        setDeckId(data.id);
        setDeckSaved(true);
        setMsg({
          type: "success",
          text: "Deck created! Now add questions below.",
        });
      }
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveQuestion = async ({ question, choices, answer }) => {
    try {
      await addCard(deckId, { question, choices, answer });
      setShowQuestionForm(false);
      refreshCards();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  };

  const handleUpdateQuestion = async ({ question, choices, answer }) => {
    try {
      await updateCard(editingCard.id, { question, choices, answer });
      setEditingCard(null);
      refreshCards();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  };

  const handleDeleteQuestion = async () => {
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
      navigate("/challenges");
    } catch (err) {
      setMsg({ type: "error", text: err.message });
      setShowDeleteModal(false);
    }
  };

  const handleCsvImport = async (questions) => {
    for (const q of questions) {
      try {
        await addCard(deckId, {
          question: q.question,
          choices: q.choices,
          answer: q.answer,
        });
      } catch {
        /* skip invalid rows */
      }
    }
    refreshCards();
  };

  const handleAIGenerate = async () => {
    if (!deckSaved || !deckId) {
      setAiError("Save the deck first before generating AI questions");
      return;
    }
    setAiGenerating(true);
    setAiError(null);
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      let data;
      if (aiMode === "vocab-deck") {
        if (!linkedFcId) {
          setAiError("Link a flashcard deck first");
          setAiGenerating(false);
          return;
        }
        const fcDeck = await getFcDeck(linkedFcId);
        data = await generateVocab(
          { cards: fcDeck.cards, count: aiCount, hint: aiHint || undefined },
          controller.signal,
        );
      } else if (aiMode === "vocab-article") {
        if (!aiArticle.trim()) {
          setAiError("Paste an article first");
          setAiGenerating(false);
          return;
        }
        data = await generateVocab(
          { article: aiArticle, count: aiCount, hint: aiHint || undefined },
          controller.signal,
        );
      } else {
        if (!aiArticle.trim()) {
          setAiError("Paste an article first");
          setAiGenerating(false);
          return;
        }
        data = await generateComprehension(
          { article: aiArticle, count: aiCount, hint: aiHint || undefined },
          controller.signal,
        );
      }
      setAiPreview(data.questions.map((q) => ({ ...q, _keep: true })));
    } catch (err) {
      if (err.name === "AbortError") return;
      setAiError(err.message);
    } finally {
      setAiGenerating(false);
      aiAbortRef.current = null;
    }
  };

  const handleAIConfirm = async () => {
    const kept = aiPreview.filter((q) => q._keep);
    let added = 0;
    try {
      for (const q of kept) {
        await addCard(deckId, {
          question: q.question,
          choices: q.choices,
          answer: q.answer,
        });
        added++;
      }
    } catch (err) {
      setMsg({
        type: "error",
        text: `Added ${added}/${kept.length} questions. Error: ${err.message}`,
      });
    }
    refreshCards();
    setAiPreview(null);
    setAiArticle("");
    setAiHint("");
    setShowAIPanel(false);
    if (added === kept.length) {
      setMsg({
        type: "success",
        text: `${kept.length} questions generated with AI!`,
      });
    }
  };

  const handleAICancel = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiGenerating(false);
  };

  const handlePublish = async () => {
    try {
      await publish(deckId);
      navigate("/challenges");
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  };

  if (loading) return <Spinner center />;

  return (
    <div>
      <BackButton onClick={() => navigate("/challenges")} />

      <h2 className="text-xl font-bold mb-4">
        {isEdit ? "Edit Challenge" : "Create Challenge"}
      </h2>

      {msg && <Alert variant={msg.type}>{msg.text}</Alert>}

      {/* Deck metadata */}
      <div className="bg-surface rounded-card shadow-card p-5 mb-4">
        <div className="flex gap-3 mb-4">
          <Input
            label="Deck Title"
            type="text"
            placeholder="e.g. Japanese N5 Quiz"
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
          placeholder="What is this challenge about?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <Select
          label="Link to Flashcard Deck (optional)"
          value={linkedFcId}
          onChange={(e) => setLinkedFcId(e.target.value)}
        >
          <option value="">No link</option>
          {fcDecks.map((d) => (
            <option key={d.id} value={String(d.id)}>
              {d.title}
            </option>
          ))}
        </Select>

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

      {/* Question editor */}
      {deckSaved && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold">Questions</h2>
            <div className="grid grid-cols-2 sm:flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setEditingCard(null);
                  setShowQuestionForm(true);
                }}
              >
                <i className="fas fa-plus" /> Add Question
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
          </div>

          {showAIPanel && (
            <div className="bg-surface rounded-card shadow-card p-5 mb-4 border border-purple-300 dark:border-purple-800">
              <h3 className="text-base font-semibold mb-2">
                <i className="fas fa-wand-magic-sparkles text-purple-500 mr-1.5" />
                AI Question Generator
              </h3>
              <p className="text-sm text-muted mb-3">
                Generate multiple-choice questions with AI.
              </p>
              {aiError && <Alert className="mb-3">{aiError}</Alert>}
              <Select
                label="Mode"
                value={aiMode}
                onChange={(e) => setAiMode(e.target.value)}
                disabled={aiGenerating}
              >
                <option value="vocab-deck">
                  Vocab from linked flashcard deck
                </option>
                <option value="vocab-article">Vocab from article</option>
                <option value="comprehension">
                  Comprehension from article
                </option>
              </Select>
              {aiMode === "vocab-deck" && !linkedFcId && (
                <Alert variant="warning" className="mb-3">
                  Link a flashcard deck above to use this mode.
                </Alert>
              )}
              {(aiMode === "vocab-article" || aiMode === "comprehension") && (
                <>
                  <div className="mb-3">
                    <label className="block text-sm font-semibold mb-1.5 text-text">
                      Article / Text
                    </label>
                    <textarea
                      placeholder="Paste your article or text here..."
                      value={aiArticle}
                      onChange={(e) => setAiArticle(e.target.value)}
                      rows={6}
                      maxLength={10000}
                      disabled={aiGenerating}
                    />
                    <div className="text-xs text-muted mt-1 text-right">
                      {aiArticle.length}/10,000
                    </div>
                  </div>
                </>
              )}
              <Input
                label={
                  <>
                    Custom Instruction{" "}
                    <span className="font-normal text-muted">(optional)</span>
                  </>
                }
                type="text"
                placeholder="e.g. Questions in Chinese, focus on grammar, easy difficulty..."
                value={aiHint}
                onChange={(e) => setAiHint(e.target.value)}
                disabled={aiGenerating}
                maxLength={500}
              />
              <div className="mb-3">
                <label className="block text-sm font-semibold mb-1.5 text-text">
                  Number of questions
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
              title={`AI Preview — ${aiPreview.filter((q) => q._keep).length} of ${aiPreview.length} questions`}
              hint="You can edit individual questions after adding if anything looks off."
              onClose={() => setAiPreview(null)}
              confirmLabel={
                <><i className="fas fa-check" /> Add {aiPreview.filter((q) => q._keep).length} Questions</>
              }
              onConfirm={handleAIConfirm}
            >
              <div className="px-5 py-4 flex flex-col gap-3">
                {aiPreview.map((q, i) => (
                  <div
                    key={i}
                    className="border border-border rounded-card p-4 transition-opacity"
                    style={{ opacity: q._keep ? 1 : 0.35 }}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted">
                          Q{i + 1}
                        </span>
                        <p className="text-sm font-semibold">{q.question}</p>
                      </div>
                      <button
                        className="shrink-0 inline-flex items-center justify-center w-6 h-6 bg-transparent border-0 cursor-pointer rounded transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        onClick={() =>
                          setAiPreview((prev) =>
                            prev.map((p, idx) =>
                              idx === i ? { ...p, _keep: !p._keep } : p,
                            ),
                          )
                        }
                        title={
                          q._keep
                            ? "Exclude this question"
                            : "Include this question"
                        }
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
                              {["A", "B", "C", "D"][ci]}
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

          {showQuestionForm && (
            <QuestionForm
              onSave={handleSaveQuestion}
              onCancel={() => setShowQuestionForm(false)}
            />
          )}

          {cards.length === 0 && !showQuestionForm && (
            <div className="text-center py-16 px-5 text-muted">
              <i className="fas fa-plus-circle text-5xl mb-3 block" />
              <p>No questions yet. Add your first question!</p>
            </div>
          )}

          {cards.map((c, i) => {
            const choices = c.choices;
            return editingCard?.id === c.id ? (
              <QuestionForm
                key={c.id}
                initialValues={{
                  question: c.question,
                  choices,
                  answer: c.answer,
                }}
                onSave={handleUpdateQuestion}
                onCancel={() => setEditingCard(null)}
              />
            ) : (
              <div
                key={c.id}
                className="bg-surface rounded-card shadow-card p-4 mb-3"
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-bold text-sm text-muted">Q{i + 1}</span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowQuestionForm(false);
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
                <strong>{c.question}</strong>
                <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
                  {choices.map((ch, ci) => {
                    const label = String.fromCharCode(65 + ci);
                    const isCorrect = ci === c.answer;
                    return (
                      <div
                        key={ci}
                        className={`flex items-start gap-2 px-3 py-2 rounded-lg ${
                          isCorrect
                            ? "bg-success/15 text-success font-semibold"
                            : "bg-surface-alt/50 text-muted"
                        }`}
                      >
                        <span
                          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                            isCorrect
                              ? "bg-success text-white"
                              : "bg-muted/20 text-muted"
                          }`}
                        >
                          {label}
                        </span>
                        <span className="leading-snug">{ch}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {cards.length > 0 && (
            <Button
              variant="success"
              className="w-full mt-4"
              onClick={() => setShowPublishModal(true)}
            >
              <i className="fas fa-rocket" /> Publish Version
            </Button>
          )}
        </>
      )}
      <Modal
        open={!!pendingDeleteCardId}
        title="Delete question?"
        message="This question will be permanently deleted."
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteQuestion}
        onCancel={() => setPendingDeleteCardId(null)}
      />
      <Modal
        open={showPublishModal}
        title="Publish new version?"
        message="This creates a new leaderboard. Previous scores will remain on their version."
        confirmLabel="Publish"
        confirmVariant="primary"
        onConfirm={() => {
          setShowPublishModal(false);
          handlePublish();
        }}
        onCancel={() => setShowPublishModal(false)}
      />
      <Modal
        open={showDeleteModal}
        title="Delete deck?"
        message={
          isPublished
            ? "This deck has been published. Deleting it will permanently remove all questions, published versions, and leaderboard scores. This cannot be undone."
            : "This will permanently delete the draft deck and all its questions. This cannot be undone."
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteDeck}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}

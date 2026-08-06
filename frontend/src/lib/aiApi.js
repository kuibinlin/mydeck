import { api } from "@/lib/apiClient";

export const getAISettings = () => api("/api/ai/settings");

export const generateFlashcards = (data, signal) =>
  api("/api/ai/generate-flashcards", {
    method: "POST",
    body: JSON.stringify(data),
    signal,
  });

export const generateVocab = (data, signal) =>
  api("/api/ai/generate-vocab", {
    method: "POST",
    body: JSON.stringify(data),
    signal,
  });

export const generateComprehension = (data, signal) =>
  api("/api/ai/generate-comprehension", {
    method: "POST",
    body: JSON.stringify(data),
    signal,
  });

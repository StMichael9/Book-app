import { createContext, useContext } from "react";

export const ReadingDraftContext = createContext(null);
export const useReadingDrafts = () => useContext(ReadingDraftContext);

export function draftKey(entryId, kind, attemptId) {
  return `${entryId}:${kind}:${attemptId || "entry"}`;
}

export function draftFields(draft) {
  if (draft.kind === "progress") return {
    unit: draft.attempt.progress_unit || "", value: draft.attempt.progress_value ?? "",
    total: draft.attempt.total_pages ?? "", started: draft.attempt.started_on || "", ended: draft.attempt.ended_on || "",
  };
  return { text: (draft.kind === "save_note" ? draft.entry.save_note : draft.attempt.note) || "", reaction: draft.attempt?.reaction || "" };
}

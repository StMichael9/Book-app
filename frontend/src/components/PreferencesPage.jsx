import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getPreferences, savePreferences } from "../api/preferences.js";
import AutocompleteInput from "./SearchBar/AutocompleteInput.jsx";

export default function PreferencesPage({
  onboarding = false,
  panel = false,
  onClose,
  onSaved,
}) {
  const navigate = useNavigate();
  const [tags, setTags] = useState([]);
  const [sourceText, setSourceText] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPreferences()
      .then((preferences) => {
        if (!active) return;
        const items = Array.isArray(preferences) ? preferences : [];
        setTags(
          items.map((item) => ({
            id: item.tag_id,
            name: item.tag?.name || `Tag ${item.tag_id}`,
            type: item.tag?.type || "tag",
          })),
        );
        setSourceText(items[0]?.source_text || "");
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || "Unable to load preferences.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const addTag = (tag) => {
    setTags((current) =>
      current.some((item) => item.id === tag.id) ? current : [...current, tag],
    );
    setTagInput("");
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await savePreferences({
        tagIds: tags.map((tag) => tag.id),
        sourceText: sourceText.trim(),
      });
      onSaved?.();
      navigate("/browse", { replace: true });
    } catch (saveError) {
      setError(saveError.message || "Unable to save preferences.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading-state">Loading preferences...</div>;

  return (
    <section className="preference-panel">
      {!panel && (
        <>
          <p className="eyebrow">{onboarding ? "A small first step" : "Your preferences"}</p>
          <h2>{onboarding ? "What do you reach for?" : "Shape your reading shelf"}</h2>
        </>
      )}
      <p className="subtitle">
        {onboarding
          ? "Choose a few themes so Shelfbound feels like your kind of library."
          : "Update your saved themes whenever your reading mood changes."}
      </p>
      <form className="preferences-form" onSubmit={handleSave}>
        <AutocompleteInput
          id="preference-tag"
          label="Favorite themes"
          value={tagInput}
          onChange={setTagInput}
          onSelectItem={addTag}
          selectedValues={tags.map((tag) => tag.name)}
          placeholder="Search themes"
          type="tag"
        />
        {tags.length > 0 && (
          <div className="preference-tags" aria-label="Selected preferences">
            {tags.map((tag) => (
              <button
                type="button"
                className="filter-pill tag-chip"
                key={tag.id}
                onClick={() => setTags((current) => current.filter((item) => item.id !== tag.id))}
              >
                {tag.name} ×
              </button>
            ))}
          </div>
        )}
        <div className="field-group">
          <label htmlFor="preference-source">Tell us more (optional)</label>
          <textarea
            id="preference-source"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="I love quiet mysteries and sprawling fantasy worlds"
            rows="4"
          />
        </div>
        {error && <p className="error-message">{error}</p>}
        <div className="controls-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving…" : "Save preferences"}
          </button>
          {(onboarding || panel) && (
            <button
              type="button"
              className="reset-button"
              onClick={() => {
                onClose?.();
                if (!panel) navigate("/browse");
              }}
            >
              {panel ? "Cancel" : "Skip for now"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
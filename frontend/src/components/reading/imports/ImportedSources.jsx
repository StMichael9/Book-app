import { useState } from "react";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import { importedSources, removeImportedSource } from "../../../api/libraryImports.js";
import { Button, NativeDialog, TextLink } from "../../ui-v2/primitives.jsx";
import "../../../styles/ui-v2/library-import.css";

const names = { goodreads: "Goodreads", storygraph: "StoryGraph", bookvane: "Bookvane CSV", generic: "a spreadsheet", paste: "a book list" };

export default function ImportedSources({ entryId, count }) {
  const library = useUserBooks(), command = useReadingCommand("Your imported context could not be loaded or updated. Please try again.");
  const [page, setPage] = useState(null), [removal, setRemoval] = useState(null);
  return <section className="bv-section"><details onToggle={event => {
    if (event.currentTarget.open && page === null && !command.pending) command.run(() => importedSources(entryId), setPage);
  }}><summary>From your import ({count}) · private</summary>
    <p className="bv-help">Imported ratings, reviews and labels are kept separately. They never replace your Bookvane notes, reactions or discovery subjects.</p>
    {command.pending && <p role="status">Loading imported details…</p>}
    {page?.items.map(record => <article key={record.id} className="bv-import-row"><h3>Imported from {names[record.source] || "your library"}</h3>
      {record.context.rating != null && <p>Imported rating: {record.context.rating} / 5</p>}
      {record.context.review && <><h4>Imported review</h4><p style={{ whiteSpace: "pre-wrap" }}>{record.context.review}</p></>}
      {record.context.private_note && <><h4>Imported private note</h4><p style={{ whiteSpace: "pre-wrap" }}>{record.context.private_note}</p></>}
      {record.context.labels?.length > 0 && <div className="bv-form-actions">{record.context.labels.map(label => <TextLink key={label} to={`/my-books?label=${encodeURIComponent(label)}`}>{label}</TextLink>)}</div>}
      {record.context.import_warnings?.length > 0 && <p className="bv-help">Import limitations: {record.context.import_warnings.map(value => value.replaceAll("_", " ")).join(", ")}. Your import may not describe every reading.</p>}
      {record.context.history_policy === "context_only" && <p className="bv-help">You chose to keep these historical spans as imported context only. They did not create readings or replace your displayed reading state.</p>}
      <details><summary>Other imported values</summary><dl>{Object.entries(record.context).filter(([key]) => !["review", "rating", "rating_scale", "labels", "private_note", "import_warnings"].includes(key)).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}</dd></div>)}</dl></details>
      {!library.readOnly && <Button variant="quiet" disabled={command.pending} onClick={() => setRemoval(record)}>Delete this imported context</Button>}
    </article>)}
    {page?.next_after && <Button disabled={command.pending} variant="secondary" onClick={() => command.run(() => importedSources(entryId, page.next_after), setPage)}>More imports</Button>}
    {command.error && <p role="alert">{command.error}<Button disabled={command.pending} onClick={() => command.run(() => importedSources(entryId), setPage)}>Try again</Button></p>}
  </details>{removal && <NativeDialog open title="Delete this imported context?" onClose={() => { if (!command.pending) setRemoval(null); }}>
    <p>This deletes only this import’s rating, review, notes and labels. Your saved book, Want to read and Owned marks, native notes and reading history stay. Minimal replay markers prevent the same file from restoring deleted text.</p>
    <div className="bv-form-actions"><Button variant="secondary" disabled={command.pending} onClick={() => setRemoval(null)}>Keep context</Button><Button disabled={command.pending} onClick={() => command.run(async assertCurrent => { await removeImportedSource(entryId, removal.id); assertCurrent(); return importedSources(entryId); }, result => { setPage(result); setRemoval(null); library.readingChanged(); })}>Delete imported context</Button></div>
    {command.error && <p role="alert">{command.error}</p>}
  </NativeDialog>}</section>;
}

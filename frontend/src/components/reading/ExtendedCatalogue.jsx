import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { useRequest } from "../ui-v2/data.js";
import { BookCover, Button, EmptyState, NativeDialog, TextLink } from "../ui-v2/primitives.jsx";
import { useLibraryNavigation } from "./libraryNavigationState.js";

// Each confirmed book is a separate intent. Closing a dialog destroys its error
// and pending command state; a retry within it retains the same request UUID.
function CatalogueConfirmation({ book, requestId, onClose }) {
  const library = useUserBooks(), go = useNavigate(), command = useReadingCommand();
  function confirm() {
    command.run(async assertCurrent => {
      assertCurrent();
      return apiRequest("/me/catalogue/select", { method: "POST", body: JSON.stringify({
        source_id: book.source_id, request_id: requestId, confirmed: true,
      }) });
    }, entry => { library.readingChanged(entry); go(`/my-books/${entry.id}`); });
  }
  return <NativeDialog open title="Is this your book?" onClose={() => { if (!command.pending) onClose(); }}>
    <h3>{book.title}</h3><p>{book.author || "Author not listed"}</p>
    <p>This saves the book privately to Want. If it is already saved, we’ll open that entry without changing it. It won’t change the shared catalogue.</p>
    {command.error && <p role="alert">{command.error}</p>}
    <div className="bv-dialog-actions"><Button variant="secondary" disabled={command.pending} onClick={onClose}>Cancel</Button><Button disabled={command.pending || library.readOnly} onClick={confirm}>{command.pending ? "Saving…" : "Confirm and open"}</Button></div>
  </NativeDialog>;
}

// Opens the private-book form with the reader's search already filled in.
export function ManualBookLink({ title = "", author = "", children }) {
  const go = useNavigate(), location = useLocation(), navigation = useLibraryNavigation();
  function manual(event) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // Only an opaque, account-scoped memory key enters browser history. Reload,
    // new tabs and account departure discard this optional bibliographic draft.
    const key = navigation.captureManualBook({ title, author, returnTo: location.pathname + location.search });
    go("/my-books/private", { state: { manualBook: key } });
  }
  return <TextLink to="/my-books/private" onClick={manual}>{children}</TextLink>;
}

export default function ExtendedCatalogue({ title = "", author = "", hasLocalResults = false }) {
  const auth = useAuth(), library = useUserBooks();
  const [selected, setSelected] = useState(null);
  const query = new URLSearchParams({ title, author });
  const request = useRequest(async () => {
    const result = await apiRequest(`/me/catalogue/search?${query}`);
    if (!Array.isArray(result?.items) || result.items.length > 30 || typeof result.available !== "boolean" ||
      result.items.some(item => !/^\/works\/OL[1-9][0-9]*W$/.test(item?.source_id) || typeof item.title !== "string" ||
        (item.author != null && typeof item.author !== "string"))) throw new Error("The extended catalogue response could not be verified.");
    return result;
  }, `extended:${auth.sessionGeneration}:${query}`, library.extendedCatalogue && Boolean(title.trim() || author.trim()));
  if (!library.extendedCatalogue || !(title.trim() || author.trim())) return null;
  const items = request.data?.items || [];
  return <>
    {request.loading ? <p role="status" className="bv-help">Checking more books…</p> : request.error || request.data?.available === false ?
      <p className="bv-help" role="status">More books are temporarily unavailable. Your existing library is unchanged. <Button variant="quiet" onClick={request.retry}>Try again</Button></p> : items.length ?
      <section className="bv-section" aria-label="More matching books"><h2>{hasLocalResults ? "More matching books" : "Matching books"}</h2><p className="bv-help">Confirm a match to add it to your private Want list. Existing entries and reading history are kept.</p>
        <div className="bv-book-grid">{items.map(item => <article key={item.source_id} className="bv-book-card">
          <BookCover book={{ ...item, authors: item.author ? [{ name: item.author }] : [] }} />
          <h3>{item.title}</h3><p className="bv-author">{item.author || "Author not listed"}</p>
          <Button variant="secondary" disabled={library.readOnly} onClick={() => setSelected({ book: item, requestId: crypto.randomUUID() })}>Review this book</Button>
        </article>)}</div>
        {request.data.more_available && <p className="bv-help">Showing the closest matches. Refine the title or author to narrow your search.</p>}
      </section> : !hasLocalResults ? <EmptyState title="No books found.">Try a shorter title or search by author. You can also add this book privately.</EmptyState> : null}
    {!library.readOnly && <p className="bv-help">Still missing your book? <ManualBookLink title={title} author={author}>Add a private book</ManualBookLink></p>}
    {selected && <CatalogueConfirmation key={selected.requestId} {...selected} onClose={() => setSelected(null)} />}
  </>;
}

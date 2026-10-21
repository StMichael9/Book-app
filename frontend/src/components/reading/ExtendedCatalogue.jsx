import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../api/client.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { useRequest } from "../ui-v2/data.js";
import { BookCover, Button, NativeDialog, TextLink } from "../ui-v2/primitives.jsx";

export default function ExtendedCatalogue({ title = "", author = "" }) {
  const auth = useAuth(), library = useUserBooks(), go = useNavigate();
  const command = useReadingCommand();
  const [selected, setSelected] = useState(null);
  const intent = useRef(null);
  const query = new URLSearchParams({ title, author });
  const request = useRequest(async () => {
    const result = await apiRequest(`/me/catalogue/search?${query}`);
    if (!Array.isArray(result?.items) || result.items.length > 30 || typeof result.available !== "boolean" ||
      result.items.some(item => !/^\/works\/OL[1-9][0-9]*W$/.test(item?.source_id) || typeof item.title !== "string" ||
        (item.author != null && typeof item.author !== "string"))) throw new Error("The extended catalogue response could not be verified.");
    return result;
  },
    `extended:${auth.sessionGeneration}:${query}`, library.extendedCatalogue && Boolean(title.trim() || author.trim()));
  if (!library.extendedCatalogue || !(title.trim() || author.trim())) return null;
  const items = request.data?.items || [];
  function choose(item) { intent.current = crypto.randomUUID(); setSelected(item); }
  function confirm() {
    command.run(async assertCurrent => {
      assertCurrent();
      return apiRequest("/me/catalogue/select", { method: "POST", body: JSON.stringify({
        source_id: selected.source_id, request_id: intent.current, confirmed: true,
      }) });
    }, entry => { library.readingChanged(entry); go(`/my-books/${entry.id}`); });
  }
  return <>
    {request.loading ? <p role="status" className="bv-help">Checking more books…</p> : request.error || request.data?.available === false ?
      <p className="bv-help" role="status">More books are temporarily unavailable. Your existing library is unchanged.</p> : items.length ?
      <section className="bv-section" aria-label="More matching books"><h2>More matching books</h2><p className="bv-help">Confirm a match to add it to your private Want list. Existing entries and reading history are kept.</p>
        <div className="bv-book-grid">{items.map(item => <article key={item.source_id} className="bv-book-card">
          <BookCover book={{ ...item, authors: item.author ? [{ name: item.author }] : [] }} />
          <h3>{item.title}</h3><p className="bv-author">{item.author || "Author not listed"}</p>
          <Button variant="secondary" disabled={library.readOnly || command.pending} onClick={() => choose(item)}>Review this book</Button>
        </article>)}</div>
        {request.data.more_available && <p className="bv-help">Showing the closest matches. Refine the title or author to narrow your search.</p>}
      </section> : null}
    <p className="bv-help">Still missing your book? <TextLink to="/my-books/private">Add a private book</TextLink></p>
    {selected && <NativeDialog open title="Is this your book?" onClose={() => { if (!command.pending) setSelected(null); }}>
      <h3>{selected.title}</h3><p>{selected.author || "Author not listed"}</p>
      <p>This saves the book privately to Want. If it is already saved, we’ll open that entry without changing it. It won’t change the shared catalogue.</p>
      {command.error && <p role="alert">{command.error}</p>}
      <div className="bv-dialog-actions"><Button variant="secondary" disabled={command.pending} onClick={() => setSelected(null)}>Cancel</Button><Button disabled={command.pending || library.readOnly} onClick={confirm}>{command.pending ? "Saving…" : "Confirm and open"}</Button></div>
    </NativeDialog>}
  </>;
}

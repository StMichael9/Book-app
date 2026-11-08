import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { deleteReadingAttempt, forgetLibraryEntry, getLibraryCsvExport, getReadingAttempt, getReadingExport, getReadingWorkspace } from "../../api/reading.js";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { Button, NativeDialog, PageHeading, TextLink } from "../ui-v2/primitives.jsx";
import { useReadingDrafts } from "./readingDraftState.js";

export function ReadingRemovalDialog({ entry, attempt, onClose, onRemoved }) {
  const command = useReadingCommand("We couldn’t confirm the removal. Please try again or reload to check."), library = useUserBooks(), go = useNavigate();
  const memory = useReadingDrafts();
  const title = entry.book?.title || entry.private_title;
  const state = attempt && ({ reading: "Reading", paused: "Paused", finished: "Finished", dnf: "Stopped" })[attempt.state];
  const record = attempt ? `${state} · ${attempt.started_on || "Start date unknown"}${attempt.ended_on ? ` → ${attempt.ended_on}` : ""}` : null;
  async function remove(assertCurrent) {
    if (!attempt) {
      try { await forgetLibraryEntry(entry.id, entry.version); }
      catch (error) {
        if (error.status !== 404) throw error;
        assertCurrent();
        // Confirm entry absence as well, rather than interpreting every
        // missing DELETE route/response as a completed removal.
        try { await getReadingWorkspace(entry.id); }
        catch (check) {
          if (check.status !== 404) throw check;
          assertCurrent();
          return null;
        }
        throw error;
      }
      assertCurrent();
      return null;
    }
    try { return await deleteReadingAttempt(attempt.id, entry.version); }
    catch (error) {
      // A lost success response may be retried. Reconcile absence, never
      // silently retry a stale version or mistake a failed request for success.
      if (error.status !== 404) throw error;
      assertCurrent();
      try { await getReadingAttempt(attempt.id); }
      catch (check) {
        if (check.status !== 404) throw check;
        assertCurrent();
        return (await getReadingWorkspace(entry.id)).entry;
      }
      throw error;
    }
  }
  return <NativeDialog open title={attempt ? "Delete this reading?" : "Forget this book?"} onClose={() => { if (!command.pending) onClose(); }}>
    <p><strong>{title}</strong></p>{record && <p>{record}</p>}
    <p>{attempt ? "Delete only this reading’s dates, progress, note and reaction. Your saved book, Want to read and Owned marks, save reason and other readings will stay." : "Remove this book from your library, including Want to read and Owned marks, save reason and every reading, note and reaction for it. Other readers’ libraries and your discovery subjects won’t change."}</p>
    <p>This cannot be undone. A download you already saved will not be changed.</p>
    <p>Unsaved drafts for {attempt ? "this reading" : "this book"} will be removed too.</p>
    <div className="bv-form-actions"><Button variant="secondary" disabled={command.pending} onClick={onClose}>Keep it</Button><Button variant="danger" disabled={command.pending || library.readOnly} onClick={() => command.run(remove, saved => {
      // Clear only after the existing command confirms removal (or verifies
      // absence). Failures must preserve the same session's private drafts.
      for (const key of Object.keys(memory.drafts)) {
        if (key.startsWith(`${entry.id}:`) && (!attempt || key.endsWith(`:${attempt.id}`))) memory.change(key, null);
      }
      if (attempt) { library.readingChanged(saved); onRemoved(); }
      else { library.readingRemoved(entry.book_id); go("/my-books", { replace: true }); }
    })}>{command.pending ? "Removing…" : attempt ? "Delete this reading" : "Forget book and history"}</Button></div>
    {command.error && <p role="alert">{command.error} Close this confirmation and reload the current book before reapplying a conflicting removal. Nothing is hidden until removal is confirmed by the server.</p>}
  </NativeDialog>;
}

function saveFile(file, name) {
  const url = URL.createObjectURL(file), link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// The spreadsheet download is independent of import: it needs only the library_export capability.
function LibraryCsvDownload() {
  const command = useReadingCommand("The download was interrupted or unavailable. Please try again.");
  const [downloaded, setDownloaded] = useState(false);
  async function download(assertCurrent) {
    setDownloaded(false);
    const response = await getLibraryCsvExport();
    assertCurrent();
    const file = await response.blob();
    assertCurrent();
    if (!file.size) throw new Error("The download was empty. Please try again.");
    const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "bookvane-library-v1.csv";
    saveFile(file, name);
  }
  return <section className="bv-data-download" aria-labelledby="bv-library-csv-title">
    <h3 id="bv-library-csv-title">Library spreadsheet (CSV)</h3>
    <p>Your books with Want to read and Owned, reading statuses, dates, page details and reading notes, in one table. Opens in Excel, Numbers or Google Sheets.</p>
    <Button variant="secondary" disabled={command.pending} onClick={() => command.run(download, () => setDownloaded(true))}>{command.pending ? "Preparing spreadsheet…" : "Download library (CSV)"}</Button>
    {downloaded && <p role="status">Spreadsheet download started. Check your Downloads folder.</p>}
    {command.error && <p role="alert">The spreadsheet couldn’t download. {command.error} Your library hasn’t changed.</p>}
  </section>;
}

export function ReadingDataPage() {
  const library = useUserBooks(), command = useReadingCommand("The download was interrupted or unavailable. Please try again.");
  const [downloaded, setDownloaded] = useState(false);
  if (!library.readingExport && !library.privacyControls && !library.libraryExport) return <Navigate to="/settings" replace />;
  async function download(assertCurrent) {
    setDownloaded(false);
    const response = await getReadingExport();
    assertCurrent();
    const file = await response.blob();
    assertCurrent();
    // Only inspect the final bounded slice, not a second full copy in memory.
    const tail = await file.slice(Math.max(0, file.size - 4096)).text();
    const footer = JSON.parse(tail.trimEnd().split("\n").at(-1));
    if (footer.type !== "complete" || footer.format_version !== 1) throw new Error("The download was interrupted. Please try again.");
    assertCurrent();
    saveFile(file, "bookvane-reading-data.jsonl");
  }
  return <section className="bv-container"><div className="bv-narrow"><TextLink to="/settings">Back to settings</TextLink><PageHeading title="Your reading data">Only you can see this.</PageHeading>
    {(library.libraryExport || library.readingExport) && <section className="bv-section"><h2>Download my data</h2>
      {library.libraryExport && <LibraryCsvDownload />}
      {library.readingExport && <section className="bv-data-download" aria-labelledby="bv-reading-json-title">
        <h3 id="bv-reading-json-title">Complete private copy (JSON)</h3>
        <p>A full backup file. We don’t keep a copy.</p>
        <Button variant="secondary" disabled={command.pending} onClick={() => command.run(download, () => setDownloaded(true))}>{command.pending ? "Preparing download…" : "Download complete copy (JSON)"}</Button>
        {downloaded && <p role="status">Download started. Check your Downloads folder.</p>}
        {command.error && <p role="alert">The download couldn’t complete. {command.error} Your library hasn’t changed. Please try again.</p>}
      </section>}
    </section>}
    <section className="bv-section"><h2>Delete my data</h2><p>To delete one reading, open the book in My Books. To remove a whole book and its history, choose Forget this book.</p><TextLink to="/my-books">Open My Books</TextLink>
      <p>Deleted data can stay in our backups for a limited time. Files you’ve already downloaded stay on your device.</p>
      <p>Email <a className="bv-text-link" href="mailto:support@bookvane.me">support@bookvane.me</a> to delete your account.</p>
    </section><TextLink to="/privacy">Read the privacy policy</TextLink></div></section>;
}

export function ReadingPrivacyPage() {
  return <section className="bv-container"><div className="bv-narrow"><PageHeading title="Your privacy">Only you can see your library.</PageHeading>
    <section className="bv-section"><h2>What we keep</h2><ul className="bv-plain-list">
      <li>Your email, and a password we can’t read.</li>
      <li>The books you save, your reading dates, notes and reactions, and your favourite genres.</li>
      <li>Only you can see your notes, reactions and private books. They are never shared or used with paid AI services.</li>
      <li>Our team can look at stored data only to help you or keep Bookvane safe.</li>
    </ul></section>
    <section className="bv-section"><h2>Who we use</h2><ul className="bv-plain-list">
      <li>Render hosts Bookvane, Neon stores the data, and Resend sends password-reset emails.</li>
      <li>Covers come from Open Library through the wsrv.nl image cache, so loading a cover contacts them.</li>
      <li>If a book has no description, we may show one from Google Books, with a link back. We don’t keep it.</li>
      <li>Some book links go to Bookshop.org. If you buy, Bookvane may earn a small commission at no cost to you.</li>
      <li>We get an error report when something breaks, and we count visits without cookies. Cookies only keep you signed in.</li>
    </ul></section>
    <section className="bv-section"><h2>Download or delete</h2><ul className="bv-plain-list">
      <li>Download everything from <TextLink to="/my-data">Your reading data</TextLink>. It’s a full backup file, and we don’t keep a copy.</li>
      <li>Delete one reading, or a whole book and its history, from My Books.</li>
      <li>Deleted data can stay in our backups for a limited time.</li>
      <li>Email <a className="bv-text-link" href="mailto:support@bookvane.me">support@bookvane.me</a> to delete your account.</li>
    </ul></section>
    <TextLink to="/settings">Settings</TextLink>
  </div></section>;
}

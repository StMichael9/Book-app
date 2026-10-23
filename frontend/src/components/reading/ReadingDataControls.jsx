import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { deleteReadingAttempt, forgetLibraryEntry, getReadingAttempt, getReadingExport, getReadingWorkspace } from "../../api/reading.js";
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
    <p>{attempt ? "Delete only this reading’s dates, progress, note and reaction. Your saved book, Want to read and Owned marks, save reason and other readings will stay." : "Remove this book from your library, including Want to read and Owned marks, save reason and every reading, note and reaction for it. Other readers, the shared catalogue and your discovery subjects will not change."}</p>
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

export function ReadingDataPage() {
  const library = useUserBooks(), command = useReadingCommand("The download was interrupted or unavailable. Please try again.");
  const [downloaded, setDownloaded] = useState(false);
  if (!library.readingExport && !library.privacyControls) return <Navigate to="/account" replace />;
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
    const url = URL.createObjectURL(file), link = document.createElement("a");
    link.href = url; link.download = "bookvane-reading-data.jsonl";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return <section className="bv-container"><div className="bv-narrow"><TextLink to="/account">Back to your account</TextLink><PageHeading title="Your reading data">Your reading context is private, not a public review or social profile.</PageHeading>
    {library.readingExport && <section className="bv-section"><h2>Download my data</h2><p>Includes your saved catalogue and private books, Want to read and Owned marks, save reasons, every reading, notes, reactions and discovery subjects. It does not include passwords, security tokens or other readers’ information.</p>
      <p className="bv-help">A JSON Lines (.jsonl) file preserves text and unknown dates. This is a personal backup, not a CSV import format or an automatic restore. We stream it directly without keeping a server-side archive. Your browser holds the download; store it somewhere private.</p>
      <Button disabled={command.pending} onClick={() => command.run(download, () => setDownloaded(true))}>{command.pending ? "Preparing download…" : "Download my data"}</Button>
      {downloaded && <p role="status">Download started. Your complete file was sent to your browser. Check Downloads; protect or delete your saved copy yourself.</p>}
      {command.error && <p role="alert">The download couldn’t complete. {command.error} Your library hasn’t changed. Please try again.</p>}
    </section>}
    <section className="bv-section"><h2>Remove reading data</h2><p>Open a book in My Books to delete one reading, or choose Forget this book to remove its entire private history. Turning off Owned or Want to read does not delete reading history.</p><TextLink to="/my-books">Open My Books</TextLink>
      <p>Removal affects the live account data. Backups may retain earlier data until their configured retention expires. Data already downloaded to your device is not erased.</p>
      <p>For full account deletion, contact the Bookvane operator through the channel where you joined or received support. We verify account ownership before deleting the account and its private records. There is no self-service account-deletion button in this version.</p>
    </section><TextLink to="/privacy">Read the privacy policy</TextLink></div></section>;
}

export function ReadingPrivacyPage() {
  return <section className="bv-container"><div className="bv-narrow"><PageHeading title="Your privacy in Bookvane">Reading is personal. Your library and reading context are not public.</PageHeading>
    <p>Bookvane stores your account email, a password hash, session and reset-token hashes, discovery preferences, saved books and any optional reading details you enter. Passwords and reset links are not included in reading exports.</p>
    <p>Private missing-book entries, save reasons, progress, dates, notes and reactions are visible only to the signed-in owner through the application. They are not shared as public reviews or used with paid AI services.</p>
    <p>The existing application uses Render for hosting, Neon PostgreSQL for storage and Resend for requested password-reset emails. Catalogue covers are supplied through Open Library; loading a remote cover contacts its image service. Browser cookies keep you signed in, and browser storage remembers appearance and local discovery choices.</p>
    <p>Authorized operators may access stored data for support, security and recovery. Do not put sensitive personal details in notes. No system can promise absolute security.</p>
    <p>You can edit or clear optional context, delete an individual reading, forget a personal book and its history, or download your reading data from your account when those controls are available. Older or paused versions may offer read-only access.</p>
    <p>Live-data removal does not erase copies you downloaded or immediately erase retained backups. Backup retention follows the configured storage service. For account deletion or privacy questions, contact the operator through your onboarding or support channel; account ownership must be verified first. This version has no self-service account-deletion button.</p>
    <TextLink to="/account">Your account and data controls</TextLink>
  </div></section>;
}

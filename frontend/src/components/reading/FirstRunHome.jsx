import { getBooks } from "../../api/books.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { catalogueResponse, firstImpressionOrder, useRequest } from "../ui-v2/data.js";
import { ActionLink, BookGrid, BookSkeletons, Button, EmptyState, PageHeading, TextLink } from "../ui-v2/primitives.jsx";

const PICKS = 10;

// Home for an account with no books yet: three ways to fill a first shelf. The two paths sit above the picks so
// they stay in view; the "shelf started" note sits right below the grid, where the third save happens.
export default function FirstRunHome() {
  const auth = useAuth(), library = useUserBooks();
  const request = useRequest(async () => catalogueResponse(await getBooks({ size: 30, cacheScope: `session:${auth.sessionGeneration}` })), `first-run:${auth.sessionGeneration}`);
  const picks = firstImpressionOrder(request.data?.items || []).slice(0, PICKS);
  const saved = picks.filter(book => library.booksById[book.id]?.is_owned || library.booksById[book.id]?.is_wanted).length;
  return <section className="bv-container bv-reading-home bv-first-run">
    <div className="bv-home-heading"><PageHeading title="Welcome. Let’s fill your first shelf." /></div>
    <div className="bv-first-run-paths">
      {library.libraryImport && !library.readOnly && <ActionLink to="/my-books/import" variant="secondary">Import from Goodreads or StoryGraph</ActionLink>}
      <TextLink to="/preferences">Tell us what you like (optional)</TextLink>
    </div>
    <section aria-labelledby="bv-first-run-pick"><h2 id="bv-first-run-pick">Pick a few books</h2>
      {request.loading ? <BookSkeletons count={5} /> : request.error ? <EmptyState error title="The books couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your library is unchanged.</EmptyState> : <BookGrid books={picks} />}
    </section>
    {saved >= 3 && <p role="status" className="bv-first-run-done"><strong>Your shelf is started.</strong> <ActionLink to="/my-books">Open My Books</ActionLink></p>}
  </section>;
}

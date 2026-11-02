import { getBookDescription } from "../../api/descriptions.js";
import DescriptionBody from "./DescriptionBody.jsx";
import { useDescription } from "./useDescription.js";

// "About this book" on the full page. Shows the description the page already has until the server answers; when it
// answers with nothing, shows nothing; when the answer can't be had, shows what the page showed before.
export default function BookAbout({ book }) {
  const answer = useDescription(() => getBookDescription(book.id), `book:${book.id}`);
  const answered = answer.status === "ok";
  const text = answered ? answer.data.text : book.description;
  const google = answered && answer.data.source === "google" && Boolean(text);
  if (!text && answer.status !== "error") return null;
  return <section className="bv-description"><h2>About this book</h2>
    {google ? <DescriptionBody text={text} link={answer.data.link} />
      : text && answered ? <p className="bv-description-full">{text}</p> : <p>{text || "A description isn’t available for this book yet. You can still save it to your library or explore its subjects."}</p>}
  </section>;
}

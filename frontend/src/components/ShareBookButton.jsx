import { useState } from "react";

function drawWrappedText(context, value, x, y, maxWidth, lineHeight, maxLines) {
  const words = value.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = word;
      if (lines >= maxLines) return;
    } else {
      line = candidate;
    }
  }
  if (line && lines < maxLines) context.fillText(line, x, y + lines * lineHeight);
}

function makeCard(book) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image sharing is unavailable in this browser.");
  context.fillStyle = "#f4efe6";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#8b3e2f";
  context.fillRect(0, 0, 20, canvas.height);
  context.font = "500 30px Georgia, serif";
  context.fillText("BOOKVANE  /  A BOOK TO EXPLORE", 76, 96);
  context.fillStyle = "#30251f";
  context.font = "500 72px Georgia, serif";
  drawWrappedText(context, book.title || "Untitled book", 76, 205, 1040, 88, 3);
  context.fillStyle = "#67594e";
  context.font = "32px Arial, sans-serif";
  const authors = book.authors?.map((author) => author.name).join(", ") || "Unknown author";
  drawWrappedText(context, `by ${authors}`, 76, 468, 1040, 40, 2);
  context.font = "26px Arial, sans-serif";
  context.fillText(`${window.location.origin}/book/${book.id}`, 76, 574);
  return canvas;
}

export default function ShareBookButton({ book }) {
  const [error, setError] = useState("");

  async function share() {
    setError("");
    try {
      const canvas = makeCard(book);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not create the book image.");
      const filename = `bookvane-book-${book.id}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: book.title, url: `${window.location.origin}/book/${book.id}` });
          return;
        } catch (shareError) {
          if (shareError.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (shareError) {
      setError(shareError.message || "Unable to share this book.");
    }
  }

  return <div className="share-book">
    <button className="reset-button" type="button" onClick={share}>Share book image</button>
    {error && <span className="error-message" role="alert">{error}</span>}
  </div>;
}

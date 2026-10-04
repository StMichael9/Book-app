import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../../hooks/AuthContext.jsx";
import { UserBooksProvider } from "../../hooks/UserBooksContext.jsx";
import "../../index.css";
import BookvaneApp from "./BookvaneApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode><BrowserRouter><AuthProvider><UserBooksProvider><BookvaneApp /></UserBooksProvider></AuthProvider></BrowserRouter></StrictMode>,
);

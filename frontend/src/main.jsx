import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { AuthProvider } from "./hooks/AuthContext.jsx";
import { UserBooksProvider } from "./hooks/UserBooksContext.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <UserBooksProvider>
          <App />
        </UserBooksProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

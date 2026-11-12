import { useLocation, useNavigate } from "react-router-dom";
import { TextLink } from "../ui-v2/primitives.jsx";
import { useLibraryNavigation } from "./libraryNavigationState.js";

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

import { createContext, useContext } from "react";

export const LibraryNavigationContext = createContext(null);
export const useLibraryNavigation = () => useContext(LibraryNavigationContext);

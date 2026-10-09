import { createContext, useContext } from "react";

export const ReaderContext = createContext(null);

export function useReader() {
  const value = useContext(ReaderContext);
  if (!value) throw new Error("ReaderProvider is required.");
  return value;
}

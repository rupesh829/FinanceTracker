import { createContext, useContext } from "react";

// Shared USD -> INR rate (set in the App header, stored in the Settings sheet tab).
export const RateContext = createContext({ rate: 83, setRate: () => {} });
export const useRate = () => useContext(RateContext);

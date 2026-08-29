const fs = require('fs');
let text = fs.readFileSync('src/store.ts', 'utf8');

const stateSearch = "interface AppState {";
const stateReplacement = "interface AppState {\n  displayCurrency: string;\n  setDisplayCurrency: (c: string) => void;\n  exchangeRates: Record<string, number>;\n  setExchangeRates: (rates: Record<string, number>) => void;";
text = text.replace(stateSearch, stateReplacement);

const implSearch = "export const useAppStore = create<AppState>((set) => ({";
const implReplacement = "export const useAppStore = create<AppState>((set) => ({\n  displayCurrency: 'KES',\n  setDisplayCurrency: (c) => set({ displayCurrency: c }),\n  exchangeRates: { KES: 1 },\n  setExchangeRates: (rates) => set({ exchangeRates: rates }),";
text = text.replace(implSearch, implReplacement);

fs.writeFileSync('src/store.ts', text);
console.log("Success");

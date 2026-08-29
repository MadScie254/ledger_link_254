const fs = require('fs');
let text = fs.readFileSync('src/store.ts', 'utf8');

if (!text.includes('isLocked: boolean;')) {
  text = text.replace('popUndoAction: () => void;', 'popUndoAction: () => void;\n  isLocked: boolean;\n  setLocked: (locked: boolean) => void;');
  text = text.replace('popUndoAction: () => set((state) => ({ undoStack: state.undoStack.slice(0, -1) }))', 'popUndoAction: () => set((state) => ({ undoStack: state.undoStack.slice(0, -1) })),\n  isLocked: false,\n  setLocked: (locked) => set({ isLocked: locked })');
  fs.writeFileSync('src/store.ts', text);
  console.log("Success");
} else {
  console.log("Already patched");
}

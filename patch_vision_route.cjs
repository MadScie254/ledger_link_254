const fs = require('fs');
let text = fs.readFileSync('src/server/routes.ts', 'utf8');

const visionRoute = `
apiRouter.post('/expenses/scan', async (req, res) => {
  try {
    const { imageBase64 } = req.body; // e.g. "iVBORw0KGgoAAAANSUhEUg..."
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing image data" });
    }
    
    // We assume the GEMINI_API_KEY is available in the environment
    const { GoogleGenAI, Type } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    
    const imagePart = {
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBase64,
      },
    };
    
    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: { parts: [imagePart, { text: "Extract the vendor name, total amount, and date from this receipt." }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            vendor: { type: Type.STRING, description: "Name of the vendor/store" },
            amount: { type: Type.NUMBER, description: "Total amount on the receipt as a number" },
            date: { type: Type.STRING, description: "Date on the receipt in YYYY-MM-DD format" }
          },
          required: ["vendor", "amount", "date"]
        }
      }
    });
    
    res.json(JSON.parse(response.text));
  } catch (err) {
    console.error("Vision API Error", err);
    res.status(500).json({ error: err.message });
  }
});
`;

if (!text.includes('/expenses/scan')) {
  fs.writeFileSync('src/server/routes.ts', text.replace('export default apiRouter;', visionRoute + '\nexport default apiRouter;'));
  console.log("Success");
} else {
  console.log("Already added");
}

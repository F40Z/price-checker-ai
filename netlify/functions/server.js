require('dotenv').config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const Groq = require("groq-sdk");
const cors = require("cors");
const path = require("path");

const app = express();
const upload = multer();

// --- 1. HEALTH CHECK (For UptimeRobot) ---
// This keeps your app awake 24/7 on the Render free tier!
app.get('/health', (req, res) => {
    res.status(200).send('I am awake!');
});

// --- SETTINGS ---
app.use(cors());
// This line allows the server to look inside the "public" folder for images/css
app.use(express.static(path.join(__dirname, 'public')));

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const groq = new Groq({ apiKey: GROQ_API_KEY });

// --- GOOGLE VISION LOGIC ---
async function detectWithGoogle(imageBuffer) {
  try {
    const base64Image = imageBuffer.toString("base64");
    const response = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_API_KEY}`,
      {
        requests: [{
            image: { content: base64Image },
            features: [
              { type: "LABEL_DETECTION", maxResults: 5 },
              { type: "WEB_DETECTION", maxResults: 3 }
            ]
        }]
      }
    );
    const labels = response.data.responses[0].labelAnnotations || [];
    const web = response.data.responses[0].webDetection?.webEntities || [];
    return [...web.map(w => w.description), ...labels.map(l => l.description)].join(", ");
  } catch (error) {
    console.error("Google Vision Error:", error.message);
    throw new Error("Vision failed");
  }
}

// --- THE FIX FOR "CANNOT GET /" ---
// This tells the server: "When someone visits the main page, send them index.html"
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API ROUTE FOR ANALYSIS ---
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please upload an image." });

    console.log("📸 Scanning image for UAE Market prices...");
    const detectedKeywords = await detectWithGoogle(req.file.buffer);

    const chat = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a UAE Marketplace Expert. 
          1. Identify the product from the keywords.
          2. Provide a realistic price range in AED.
          3. Recommend UAE platforms like Dubizzle, OpenSooq, Facebook Marketplace, etc.`
        },
        {
          role: "user",
          content: `Keywords: "${detectedKeywords}". What is this and what is it worth in the UAE?`
        }
      ],
      model: "llama-3.3-70b-versatile"
    });

    res.json({
      success: true,
      product: detectedKeywords.split(',')[0], 
      ai_analysis: chat.choices[0].message.content
    });

  } catch (error) {
    console.error("Analysis Error:", error);
    res.status(500).json({ error: "The AI had a hiccup. Check your API keys!" });
  }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 SUCCESS! Your UAE AI Scout is ready.`);
    console.log(`👉 Open your browser and go to: http://localhost:${PORT}\n`);
});
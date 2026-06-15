const express = require('express');
const multer = require('multer');
const serverless = require('serverless-http');

const app = express();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json());

app.post('/api/analyze', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No image file uploaded.' });
        }

        const googleApiKey = process.env.GOOGLE_API_KEY;
        const groqApiKey = process.env.GROQ_API_KEY;

        if (!googleApiKey || !groqApiKey) {
            return res.status(500).json({ 
                success: false, 
                error: 'Missing API keys. Check your Netlify environment variables.' 
            });
        }

        // 1. CALL GOOGLE VISION API
        const imageBase64 = req.file.buffer.toString('base64');
        const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${googleApiKey}`;
        
        const visionResponse = await fetch(visionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{
                    image: { content: imageBase64 },
                    features: [
                        { type: 'LABEL_DETECTION', maxResults: 5 }, 
                        { type: 'WEB_DETECTION', maxResults: 10 }
                    ]
                }]
            })
        });

        const visionData = await visionResponse.json();
        const visionResult = visionData.responses?.[0];
        
        if (!visionResult) {
            return res.status(500).json({ success: false, error: 'Invalid Google Vision response structure.' });
        }

        const webDetection = visionResult.webDetection;
        const labels = visionResult.labelAnnotations;
        
        let identityGuesses = [];
        
        if (webDetection?.bestGuessLabels?.[0]?.label) {
            identityGuesses.push(webDetection.bestGuessLabels[0].label);
        }
        
        if (webDetection?.webEntities) {
            webDetection.webEntities.forEach(entity => {
                if (entity.description) identityGuesses.push(entity.description);
            });
        }
        
        if (labels) {
            labels.forEach(l => {
                if (l.description) identityGuesses.push(l.description);
            });
        }

        const fallbackProduct = labels?.[0]?.description || "Item";
        const finalTitle = webDetection?.bestGuessLabels?.[0]?.label || fallbackProduct;
        const detailedContext = identityGuesses.length > 0 ? identityGuesses.join(', ') : fallbackProduct;

        // 2. UNIVERSAL ASSET APPRAISAL PROMPT FOR GROQ
        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const promptText = `You are an expert UAE marketplace appraiser and luxury asset valuator. 
        An image matching engine analyzed a photo and extracted these web matching clues: "${detailedContext}".
        
        Your critical job:
        1. Identify exactly what the item is (e.g., "PlayStation 5 Slim (1TB)", "2021 Jaguar F-Pace SVR", "iPhone 15 Pro Max"). Be as specific as possible regarding model/generation based on the clues.
        2. Output a beautifully organized marketplace report in clean Markdown format for a mobile application screen.
        
        Include:
        - 📦 **Exact Item Identification**: Explicitly state your calculated brand, specific model, and edition/spec right at the start. Use an appropriate emoji (e.g., 🚗 for cars, 🎮 for gaming, 📱 for phones).
        - 💰 **Estimated UAE Market Value Range**: Give an accurate estimated second-hand valuation range in AED based on the current Dubai/Abu Dhabi secondary market.
        - 📊 **Market Demand Level**: Specific demand rating (High, Medium, Low) for this specific item type in the UAE and a brief reason why.
        - 📍 **Where to Sell It**: List targeted UAE channels. For cars use (Dubizzle Motors, YallaMotor, CarSwitch). For electronics/general items use (Dubizzle, Facebook Marketplace UAE, Amazon/Cartlow trade-in, or local classifieds groups).
        - 💡 **Pro-Tips for Selling**: Practical tips for cleaning, packaging, listing, or factory-resetting to get a premium return for this specific item type in the UAE.
        
        Be highly professional, direct, and dynamic based on the asset type. Do not use generic "N/A" placeholders. Give the analysis directly to the user.`;

        const groqResponse = await fetch(groqUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: promptText }],
                temperature: 0.3
            })
        });

        const groqData = await groqResponse.json();
        const aiReport = groqData.choices?.[0]?.message?.content || "Error generating appraisal report.";

        res.json({
            success: true,
            product: finalTitle.toUpperCase(),
            ai_analysis: aiReport
        });

    } catch (error) {
        console.error("Valuation Engine Crash:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports.handler = serverless(app);

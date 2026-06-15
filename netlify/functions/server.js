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
        
        // Safe check for root response array
        const visionResult = visionData.responses?.[0];
        if (!visionResult) {
            return res.status(500).json({ success: false, error: 'Invalid Google Vision response structural setup.' });
        }

        const webDetection = visionResult.webDetection;
        const labels = visionResult.labelAnnotations;
        
        // Safely extract web entity clues to identify exact models
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

        // Fallback names if matches fail
        const fallbackProduct = labels?.[0]?.description || "Vehicle / Asset";
        const finalTitle = webDetection?.bestGuessLabels?.[0]?.label || fallbackProduct;
        
        // Flatten array to strings for Groq prompt context
        const detailedContext = identityGuesses.length > 0 ? identityGuesses.join(', ') : fallbackProduct;

        // 2. ASK GROQ AI TO SPECIFY MODEL & CALCULATE VALUATION
        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const promptText = `You are an expert UAE marketplace car appraiser and luxury asset valuator. 
        An image matching engine analyzed a photo and extracted these web matching clues: "${detailedContext}".
        
        Your critical job:
        1. Pinpoint the exact Year, Make, and Model of the vehicle from those clues (e.g., "2021 Jaguar F-Pace SVR", "2023 Jaguar E-Pace SE"). If the exact year is tight, use a precise model range.
        2. Output a beautifully organized marketplace report in clean Markdown format for a mobile application screen.
        
        Include:
        - 🚗 **Exact Vehicle Identification**: Explicitly list your calculated Year, Make, Model, and Trim/Spec right at the start.
        - 💰 **Estimated UAE Market Value Range**: Give an accurate estimated valuation range in AED based on the current Dubai/Abu Dhabi secondary market.
        - 📊 **Market Demand Level**: Specific demand rating (High, Medium, Low) for this vehicle in the UAE.
        - 📍 **Where to Sell It**: List specialized car portals (Dubizzle Motors, YallaMotor, CarSwitch, or luxury showrooms).
        - 💡 **Pro-Tips for Selling**: Practical tips for getting a premium return on this specific make/type of vehicle in the UAE.
        
        Be highly professional, direct, and omit any structural labels or system mentions. Give the answer directly to the user.`;

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
        const aiReport = groqData.choices?.[0]?.message?.content || "Error generating appraisal breakdown report.";

        // Send successful execution payload back to interface
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

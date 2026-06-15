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
                error: 'Missing API configuration. Please check your Netlify environment variables.' 
            });
        }

        // 1. SCAN IMAGE WITH GOOGLE VISION (Using WEB_DETECTION for exact matches)
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
                        { type: 'WEB_DETECTION', maxResults: 10 } // 🧠 Added to find exact model names online
                    ]
                }]
            })
        });

        const visionData = await visionResponse.json();
        const webDetection = visionData.responses[0]?.webDetection;
        const labels = visionData.responses[0]?.labelAnnotations;
        
        // Extract best guesses and web entities (like "Jaguar F-Pace", "2021")
        let identityGuesses = [];
        if (webDetection?.bestGuessLabels) {
            identityGuesses.push(...webDetection.bestGuessLabels.map(g => g.label));
        }
        if (webDetection?.webEntities) {
            // Filter in specific terms like car brands/models, avoiding generic words
            const vehicleKeywords = webDetection.webEntities
                .filter(e => e.description)
                .map(e => e.description);
            identityGuesses.push(...vehicleKeywords);
        }
        if (labels) {
            identityGuesses.push(...labels.map(l => l.description));
        }

        const fallbackProduct = labels?.[0]?.description || "Unknown Item";
        const detailedContext = identityGuesses.join(', ');

        // 2. ASK GROQ AI TO PINPOINT AND VALUE IT
        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const promptText = `You are an expert UAE marketplace car appraiser and luxury valuator. 
        An image matching engine analyzed a vehicle photo and extracted these web matching clues: "${detailedContext}".
        
        Your job:
        1. Identify the exact Year, Make, and Model of the vehicle based on those clues (e.g., "2022 Jaguar F-Pace SVR" or "2020 Jaguar I-Pace"). If the exact year is ambiguous, specify a highly accurate generation range (e.g., "2021-2024 Jaguar F-Pace").
        2. Provide a tailored market analysis formatted in clean Markdown for a mobile app screen.
        
        Include:
        - 🚗 **Exact Vehicle Identification**: State your highly accurate conclusion for the Year, Make, Model, and Trim clearly at the top.
        - 💰 **Estimated UAE Market Value Range**: Provide a realistic value range in AED based on the current UAE used car market.
        - 📊 **Market Demand Level**: Specific demand rating for this vehicle in Dubai/Abu Dhabi.
        - 📍 **Where to Sell It**: Mention relevant platforms (Dubizzle, YallaMotor, CarSwitch, or specialized luxury showrooms).
        - 💡 **Pro-Tips for Selling**: Specific advice for selling this specific brand/type of vehicle in the UAE.
        
        Keep it direct, professional, and do not mention the technical data clues.`;

        const groqResponse = await fetch(groqUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: promptText }],
                temperature: 0.4 // Lower temperature makes it focus harder on the clues
            })
        });

        const groqData = await groqResponse.json();
        const aiReport = groqData.choices?.[0]?.message?.content || "Error generating appraisal report.";

        // Use the first guess as the header title, fallback if empty
        const finalTitle = webDetection?.bestGuessLabels?.[0]?.label || fallbackProduct;

        res.json({
            success: true,
            product: finalTitle.toUpperCase(),
            ai_analysis: aiReport
        });

    } catch (error) {
        console.error("Server Valuation Error:", error);
        res.status(500).json({ success: false, error:

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

        // 1. SCAN IMAGE WITH GOOGLE VISION
        const imageBase64 = req.file.buffer.toString('base64');
        const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${googleApiKey}`;
        
        const visionResponse = await fetch(visionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{
                    image: { content: imageBase64 },
                    features: [{ type: 'LABEL_DETECTION', maxResults: 10 }, { type: 'OBJECT_LOCALIZATION' }]
                }]
            })
        });

        const visionData = await visionResponse.json();
        const labels = visionData.responses[0]?.labelAnnotations;
        
        if (!labels || labels.length === 0) {
            return res.status(200).json({ 
                success: true, 
                product: "Unknown Item", 
                ai_analysis: "Could not clearly identify the item. Try taking a photo with better lighting!" 
            });
        }

        // Create a descriptive string of everything Google saw in the image
        const detectedFeatures = labels.map(l => l.description).join(', ');
        const topProduct = labels[0].description;

        // 2. ASK GROQ AI FOR UAE MARKETPLACE VALUATION
        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        const promptText = `You are an expert UAE marketplace app appraiser. An image analysis tool scanned an item and found these details: "${detectedFeatures}". 
        Assuming the user is looking at the top identified item ("${topProduct}"), provide a clean, professional market analysis formatted in clean Markdown for a mobile app screen.
        
        Include:
        1. 💰 Estimated Market Value Range in AED (United Arab Emirates Dirham).
        2. 📊 Market Demand Level (High, Medium, Low) in the UAE and short reasoning.
        3. 📍 Where to Sell It (Mention specific local platforms like Dubizzle, OpenSooq, Facebook Marketplace UAE, or specialized local buyer networks).
        4. 💡 Pro-Tips for Selling (How to clean/list it to get top dollar in Dubai/Abu Dhabi).
        
        Keep your response highly readable, split into distinct bullet points, and use emojis. Do not mention "Google Vision" or the raw data features list in your final text. Keep it direct and helpful to the seller.`;

        const groqResponse = await fetch(groqUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: promptText }],
                temperature: 0.7
            })
        });

        const groqData = await groqResponse.json();
        const aiReport = groqData.choices?.[0]?.message?.content || "Error generating financial valuation data.";

        // Send the complete intelligence report back to the UI
        res.json({
            success: true,
            product: topProduct,
            ai_analysis: aiReport
        });

    } catch (error) {
        console.error("Server Valuation Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports.handler = serverless(app);

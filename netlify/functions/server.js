const express = require('express');
const multer = require('multer');
const { GoogleAuth } = require('google-auth-library');
const serverless = require('serverless-http');

const app = express();

// Set up memory storage for image uploads (crucial for Netlify Serverless!)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json());

// Main API analysis route
app.post('/api/analyze', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No image file uploaded.' });
        }

        // Pull the API key we stored securely in your Netlify Environment Variables
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, error: 'Google API Key is not configured on the server.' });
        }

        // Convert the uploaded image buffer to a base64 string for Google Vision
        const imageBase64 = req.file.buffer.toString('base64');

        // Prepare the payload for the Google Vision API
        const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
        
        const payload = {
            requests: [
                {
                    image: { content: imageBase64 },
                    features: [{ type: 'LABEL_DETECTION', maxResults: 10 }]
                }
            ]
        };

        // Send request to Google Vision
        const response = await fetch(visionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const visionData = await response.json();
        
        if (!visionData.responses || visionData.responses.length === 0) {
            return res.status(500).json({ success: false, error: 'Failed to get a response from Google Vision.' });
        }

        const labels = visionData.responses[0].labelAnnotations;
        if (!labels || labels.length === 0) {
            return res.status(200).json({ 
                success: true, 
                product: "Unknown Item", 
                ai_analysis: "The AI scanner couldn't confidently identify objects in this image. Please try a clearer picture!" 
            });
        }

        // Grab the top detected item label
        const topProduct = labels[0].description;

        // Formulate a simple marketplace pricing response
        const marketFeedback = `📈 **UAE Market Estimate Analysis**\n\n` +
                               `• **Detected Item:** ${topProduct}\n` +
                               `• **Status:** Successfully scanned via Google Vision!\n` +
                               `• **Note:** To enable deeper automated AED valuations, integrate an OpenAI/Gemini text generation prompt text block here using the label data.`;

        // Send successful JSON back to your index.html frontend
        res.json({
            success: true,
            product: topProduct,
            ai_analysis: marketFeedback
        });

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ⚡ Netlify Serverless Wrapper (replaces app.listen)
module.exports.handler = serverless(app);

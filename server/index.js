const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Check if API keys are set (support for dual API keys)
const apiKey1 = process.env.GEMINI_API_KEY;
const apiKey2 = process.env.GEMINI_API_KEY_2;
const apiKeys = [apiKey1, apiKey2].filter(Boolean);

if (apiKeys.length === 0) {
  console.error('⚠️  WARNING: No GEMINI_API_KEY is set in .env file');
  console.error('Please create a .env file in the server directory with: GEMINI_API_KEY=your_key_here');
}

// Initialize Gemini AI with primary key, fallback to secondary
let genAI;
let currentApiKeyIndex = 0;

try {
  genAI = new GoogleGenerativeAI(apiKeys[0] || '');
} catch (error) {
  console.error('Error initializing Gemini AI:', error.message);
}

// Function to switch API key if one fails
const switchApiKey = () => {
  if (apiKeys.length > 1) {
    currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeys.length;
    genAI = new GoogleGenerativeAI(apiKeys[currentApiKeyIndex]);
    console.log(`Switched to API key ${currentApiKeyIndex + 1}`);
  }
};

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ 
        error: 'Message is required',
        success: false 
      });
    }

    if (apiKeys.length === 0) {
      return res.status(500).json({
        error: 'API key not configured. Please set GEMINI_API_KEY in server/.env file',
        success: false
      });
    }

    // Get the generative model - use gemini-2.5-flash (fast and available)
    // Fallback to gemini-2.5-pro if flash is not available
    let model;
    try {
      model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    } catch (e) {
      try {
        model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
      } catch (e2) {
        // Last fallback
        model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      }
    }

    // Build conversation history
    let chat;
    if (history && history.length > 0) {
      const formattedHistory = history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content || msg.text || '' }]
      })).filter(msg => msg.parts[0].text.trim() !== '');
      
      chat = model.startChat({
        history: formattedHistory
      });
    } else {
      chat = model.startChat();
    }

    // Send message and get response
    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    res.json({
      message: text,
      success: true
    });
  } catch (error) {
    console.error('Error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    let errorMessage = 'Failed to get response from AI';
    if (error.message.includes('API_KEY')) {
      errorMessage = 'Invalid or missing API key. Please check your GEMINI_API_KEY in server/.env';
    } else if (error.message.includes('quota') || error.message.includes('429')) {
      errorMessage = 'API quota exceeded. Please try again later.';
    } else if (error.message.includes('safety')) {
      errorMessage = 'The message was blocked by safety filters. Please try rephrasing.';
    }
    
    // If API quota/rate limit error, try switching API key
    if ((error.message.includes('quota') || error.message.includes('429') || error.message.includes('API_KEY')) && apiKeys.length > 1) {
      try {
        switchApiKey();
        // Retry with new API key
        const retryModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const retryChat = retryModel.startChat();
        const retryResult = await retryChat.sendMessage(message);
        const retryResponse = await retryResult.response;
        const retryText = retryResponse.text();
        
        return res.json({
          message: retryText,
          success: true
        });
      } catch (retryError) {
        console.error('Retry with alternate API key failed:', retryError);
      }
    }
    
    res.status(500).json({
      error: errorMessage,
      details: error.message,
      success: false
    });
  }
});

// List available models endpoint
app.get('/api/models', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'API key not configured',
        success: false
      });
    }
    
    // Try to get available models
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    
    res.json({
      models: data.models || [],
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch models',
      details: error.message,
      success: false
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Arivu AI Server is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 Arivu AI Server running on port ${PORT}`);
});


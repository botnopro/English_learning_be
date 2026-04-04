const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Lấy thông tin từ từ Dictionary API
const fetchFromDictionary = async (word) => {
  try {
    const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
    const data = response.data[0];
    
    return {
      pronunciation: data.phonetic || '',
      partOfSpeech: data.meanings?.[0]?.partOfSpeech || '',
      definitions: data.meanings?.[0]?.definitions?.map(d => d.definition) || [],
      examples: data.meanings?.[0]?.definitions?.map(d => d.example).filter(Boolean) || [],
      synonyms: data.meanings?.[0]?.synonyms || []
    };
  } catch (error) {
    console.log(`Dictionary API failed for word: ${word}`);
    return null;
  }
};

// Sinh thông tin từ bằng Gemini
const enrichWithGemini = async (englishWord, vietnameseWord) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `Provide information about the English word "${englishWord}"${vietnameseWord ? ` (Vietnamese: ${vietnameseWord})` : ''} in JSON format with these fields:
    {
      "pronunciation": "IPA pronunciation",
      "partOfSpeech": "noun/verb/adjective/etc",
      "definitions": ["definition 1", "definition 2"],
      "examples": ["example sentence 1", "example sentence 2"],
      "synonyms": ["synonym1", "synonym2"]
    }
    Return only valid JSON.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error) {
    console.log(`Gemini enrichment failed: ${error.message}`);
    return null;
  }
};

// Hàm chính để lấy thông tin từ
const enrichWord = async (englishWord, vietnameseWord) => {
  let enrichedData = {};

  // Thử lấy từ Dictionary API trước
  const dictionaryData = await fetchFromDictionary(englishWord);
  if (dictionaryData) {
    enrichedData = dictionaryData;
  }

  // Nếu Dictionary API không đủ thông tin, dùng Gemini
  if (!enrichedData.definitions || enrichedData.definitions.length === 0) {
    const geminiData = await enrichWithGemini(englishWord, vietnameseWord);
    if (geminiData) {
      enrichedData = { ...enrichedData, ...geminiData };
    }
  }

  return enrichedData;
};

module.exports = { enrichWord, fetchFromDictionary, enrichWithGemini };

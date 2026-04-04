const Word = require('../models/Word');
const Interaction = require('../models/Interaction');
const UserWordProgress = require('../models/UserWordProgress');
const { enrichWord } = require('../utils/wordEnricher');

const toPositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

const pickRandom = (items, count) => {
  const shuffled = [...items].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

// Tạo từ mới
exports.createWord = async (req, res) => {
  try {
    const { englishWord, vietnameseWord, topics, level } = req.body;

    if (!englishWord) {
      return res.status(400).json({ message: 'English word is required' });
    }

    // Kiểm tra từ đã tồn tại
    const existingWord = await Word.findOne({ englishWord: englishWord.toLowerCase() });
    if (existingWord) {
      return res.status(400).json({ message: 'Word already exists' });
    }

    // Lấy thông tin từ từ Dictionary API hoặc Gemini
    const enrichedData = await enrichWord(englishWord, vietnameseWord);

    const word = new Word({
      englishWord: englishWord.toLowerCase(),
      vietnameseWord: vietnameseWord || '',
      pronunciation: enrichedData.pronunciation || '',
      partOfSpeech: enrichedData.partOfSpeech || '',
      definitions: enrichedData.definitions || [],
      examples: enrichedData.examples || [],
      synonyms: enrichedData.synonyms || [],
      topics: Array.isArray(topics) && topics.length > 0 ? topics : (enrichedData.topics || ['general']),
      level: level || 3,
      createdBy: req.user.id
    });

    await word.save();

    await UserWordProgress.updateOne(
      { userId: req.user.id, wordId: word._id },
      {
        $setOnInsert: {
          level: word.level,
          addedAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.status(201).json({ message: 'Word created successfully', word });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addToMyVocabulary = async (req, res) => {
  try {
    const word = await Word.findById(req.params.id);
    if (!word) {
      return res.status(404).json({ message: 'Word not found' });
    }

    const result = await UserWordProgress.updateOne(
      { userId: req.user.id, wordId: word._id },
      {
        $setOnInsert: {
          level: word.level || 3,
          addedAt: new Date(),
        },
      },
      { upsert: true }
    );

    const isAddedNow = result.upsertedCount > 0;
    return res.json({
      message: isAddedNow ? 'Word added to your vocabulary' : 'Word already exists in your vocabulary',
      wordId: word._id,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.reviewByTopic = async (req, res) => {
  try {
    const { topic } = req.query;
    const count = toPositiveInt(req.query.count, 10);
    const mineOnly = req.query.mineOnly === 'true';

    if (!topic) {
      return res.status(400).json({ message: 'topic is required' });
    }

    let words;
    if (mineOnly && req.user?.id) {
      const progressRecords = await UserWordProgress.find({ userId: req.user.id })
        .populate({
          path: 'wordId',
          match: { topics: topic },
          populate: { path: 'createdBy', select: 'username' },
        });

      words = progressRecords
        .filter((record) => record.wordId)
        .map((record) => ({
          ...record.wordId.toObject(),
          personalLevel: record.level,
        }));
    } else {
      words = await Word.find({ topics: topic }).populate('createdBy', 'username');
    }

    const selected = pickRandom(words, count);
    return res.json({
      mode: mineOnly && req.user?.id ? 'my-vocabulary' : 'public',
      topic,
      totalCandidates: words.length,
      count: selected.length,
      words: selected,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.reviewByLevel = async (req, res) => {
  try {
    const level = parseInt(req.query.level, 10);
    const count = toPositiveInt(req.query.count, 10);
    const mineOnly = req.query.mineOnly === 'true';

    if (Number.isNaN(level) || level < 1 || level > 6) {
      return res.status(400).json({ message: 'level must be an integer from 1 to 6' });
    }

    let words;
    if (mineOnly && req.user?.id) {
      const progressRecords = await UserWordProgress.find({ userId: req.user.id, level })
        .populate({ path: 'wordId', populate: { path: 'createdBy', select: 'username' } });

      words = progressRecords
        .filter((record) => record.wordId)
        .map((record) => ({
          ...record.wordId.toObject(),
          personalLevel: record.level,
        }));
    } else {
      words = await Word.find({ level }).populate('createdBy', 'username');
    }

    const selected = pickRandom(words, count);
    return res.json({
      mode: mineOnly && req.user?.id ? 'my-vocabulary' : 'public',
      level,
      totalCandidates: words.length,
      count: selected.length,
      words: selected,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Lấy tất cả từ
exports.getAllWords = async (req, res) => {
  try {
    const { level, topic, limit = 20, skip = 0 } = req.query;
    let query = {};

    if (level) query.level = parseInt(level);
    if (topic) query.topics = topic;

    const words = await Word.find(query)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .populate('createdBy', 'username');

    const total = await Word.countDocuments(query);

    res.json({ words, total, limit: parseInt(limit), skip: parseInt(skip) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Lấy chi tiết từ
exports.getWordById = async (req, res) => {
  try {
    const word = await Word.findById(req.params.id).populate('createdBy', 'username');
    if (!word) {
      return res.status(404).json({ message: 'Word not found' });
    }
    res.json(word);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Cập nhật từ (User chỉ cập nhật từ của mình, Admin cập nhật tất cả)
exports.updateWord = async (req, res) => {
  try {
    const word = await Word.findById(req.params.id);
    if (!word) {
      return res.status(404).json({ message: 'Word not found' });
    }

    // Kiểm tra quyền
    if (req.user.role !== 'admin' && word.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You do not have permission to update this word' });
    }

    const { englishWord, vietnameseWord, level, topics, pronunciation, definitions, examples } = req.body;

    if (englishWord) word.englishWord = englishWord.toLowerCase();
    if (vietnameseWord !== undefined) word.vietnameseWord = vietnameseWord;
    if (level) word.level = level;
    if (topics) word.topics = topics;
    if (pronunciation) word.pronunciation = pronunciation;
    if (definitions) word.definitions = definitions;
    if (examples) word.examples = examples;

    word.updatedAt = Date.now();
    await word.save();

    res.json({ message: 'Word updated successfully', word });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Xóa từ (User chỉ xóa từ của mình, Admin xóa tất cả)
exports.deleteWord = async (req, res) => {
  try {
    const word = await Word.findById(req.params.id);
    if (!word) {
      return res.status(404).json({ message: 'Word not found' });
    }

    // Kiểm tra quyền
    if (req.user.role !== 'admin' && word.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You do not have permission to delete this word' });
    }

    await Word.findByIdAndDelete(req.params.id);
    res.json({ message: 'Word deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Ghi nhận tương tác người dùng
exports.recordInteraction = async (req, res) => {
  try {
    const { isCorrect } = req.body;
    const wordId = req.params.id;

    const word = await Word.findById(wordId);
    if (!word) {
      return res.status(404).json({ message: 'Word not found' });
    }

    // Lưu tương tác
    const interaction = new Interaction({
      userId: req.user.id,
      wordId: wordId,
      isCorrect: isCorrect
    });
    await interaction.save();

    const progress = await UserWordProgress.findOneAndUpdate(
      { userId: req.user.id, wordId: wordId },
      {
        $setOnInsert: {
          level: word.level || 3,
          addedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // Cập nhật độ khó của từ dựa trên tương tác
    const recentInteractions = await Interaction.find({ wordId: wordId, userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(2);

    let newLevel = progress.level;
    if (isCorrect === false) {
      newLevel = Math.min(6, progress.level + 1);
    } else if (isCorrect === true && recentInteractions.length >= 2) {
      if (recentInteractions[0].isCorrect && recentInteractions[1].isCorrect) {
        newLevel = Math.max(1, progress.level - 1);
      }
    }

    progress.level = newLevel;
    progress.lastReviewedAt = new Date();
    await progress.save();

    res.json({ message: 'Interaction recorded', newLevel: progress.level });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

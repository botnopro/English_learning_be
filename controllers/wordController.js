const Word = require('../models/Word');
const Interaction = require('../models/Interaction');
const UserWordProgress = require('../models/UserWordProgress');
const { enrichWord } = require('../utils/wordEnricher');

const toPositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

const REVIEW_LEVEL_WEIGHTS = {
  1: 10,
  2: 30,
  3: 50,
  4: 60,
  5: 80,
  6: 100,
};

const shuffle = (items) => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
};

const getEffectiveLevel = (word) => {
  const parsedLevel = parseInt(word?.personalLevel ?? word?.level, 10);
  if (Number.isNaN(parsedLevel) || parsedLevel < 1 || parsedLevel > 6) {
    return 3;
  }
  return parsedLevel;
};

const pickWeightedByLevel = (items, count) => {
  if (!Array.isArray(items) || items.length === 0 || count <= 0) {
    return [];
  }

  const pool = [...items];
  const selected = [];
  const targetCount = Math.min(count, pool.length);

  while (selected.length < targetCount && pool.length > 0) {
    const weightedPool = pool.map((item) => ({
      item,
      weight: REVIEW_LEVEL_WEIGHTS[getEffectiveLevel(item)] || REVIEW_LEVEL_WEIGHTS[3],
    }));

    const totalWeight = weightedPool.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = Math.random() * totalWeight;
    let selectedIndex = 0;

    for (let index = 0; index < weightedPool.length; index += 1) {
      threshold -= weightedPool[index].weight;
      if (threshold <= 0) {
        selectedIndex = index;
        break;
      }
    }

    selected.push(weightedPool[selectedIndex].item);
    pool.splice(selectedIndex, 1);
  }

  return shuffle(selected);
};

const normalizeWordInput = (value) => (typeof value === 'string' ? value.trim() : '');

const toObjectIdStrings = (ids) => ids.map((id) => id.toString());

const buildAccessQueryForWords = async (user) => {
  if (user?.role === 'admin') {
    return {};
  }

  const publicWordIds = await UserWordProgress.distinct('wordId', { isPublic: true });
  const publicWordIdStrings = toObjectIdStrings(publicWordIds);

  if (!user?.id) {
    return {
      _id: { $in: publicWordIdStrings },
    };
  }

  const savedWordIds = await UserWordProgress.distinct('wordId', { userId: user.id });
  const mergedWordIds = [...new Set([...toObjectIdStrings(savedWordIds), ...publicWordIdStrings])];

  return {
    $or: [
      { createdBy: user.id },
      { _id: { $in: mergedWordIds } },
    ],
  };
};

const canUserAccessWord = async (user, word) => {
  if (user?.role === 'admin') return true;

  const wordId = word._id.toString();
  if (user?.id && word.createdBy?.toString() === user.id) return true;

  if (user?.id) {
    const saved = await UserWordProgress.exists({ userId: user.id, wordId });
    if (saved) return true;
  }

  const isPublic = await UserWordProgress.exists({ wordId, isPublic: true });
  return !!isPublic;
};

const buildReviewResponse = ({ mode, filterType, filterValue, candidates, selected }) => ({
  mode,
  filter: {
    type: filterType,
    value: filterValue,
  },
  totalCandidates: candidates.length,
  count: selected.length,
  words: selected,
});

const buildWordFromProgress = (record) => {
  const baseWord = record.wordId?.toObject?.() || null;
  if (!baseWord) return null;

  const personalEnglishWord = normalizeWordInput(record.personalEnglishWord);
  const personalVietnameseWord = normalizeWordInput(record.personalVietnameseWord);

  return {
    ...baseWord,
    englishWord: personalEnglishWord || baseWord.englishWord || '',
    vietnameseWord: personalVietnameseWord || baseWord.vietnameseWord || '',
    isPublic: !!record.isPublic,
    personalLevel: record.level,
    personalNote: record.personalNote || '',
    personalTags: Array.isArray(record.personalTags) ? record.personalTags : [],
    addedAt: record.addedAt,
    lastReviewedAt: record.lastReviewedAt || null,
  };
};

const getMyVocabularyWords = async (userId, count) => {
  const progressRecords = await UserWordProgress.find({ userId })
    .populate({ path: 'wordId', populate: { path: 'createdBy', select: 'username' } });

  const builtWords = progressRecords.map(buildWordFromProgress).filter(Boolean);
  return pickWeightedByLevel(builtWords, count);
};

const getUserProgressWordsByTopic = async (userId, topic) => {
  const progressRecords = await UserWordProgress.find({ userId })
    .populate({
      path: 'wordId',
      match: { topics: topic },
      populate: { path: 'createdBy', select: 'username' },
    });

  return progressRecords.map(buildWordFromProgress).filter(Boolean);
};

const getUserProgressWordsByLevel = async (userId, level) => {
  const progressRecords = await UserWordProgress.find({ userId, level })
    .populate({ path: 'wordId', populate: { path: 'createdBy', select: 'username' } });

  return progressRecords.map(buildWordFromProgress).filter(Boolean);
};

const getCommunityWords = async ({ count, topic, level }) => {
  const wordMatch = {};
  if (topic) wordMatch.topics = topic;
  if (level !== undefined) wordMatch.level = level;

  const progressRecords = await UserWordProgress.find({ isPublic: true })
    .sort({ updatedAt: -1 })
    .limit(count)
    .populate({
      path: 'wordId',
      match: wordMatch,
      populate: { path: 'createdBy', select: 'username' },
    })
    .populate('userId', 'username');

  return progressRecords
    .map((record) => {
      const word = buildWordFromProgress(record);
      if (!word) return null;

      return {
        sourceEntryId: record._id,
        ...word,
        sharedBy: record.userId
          ? { _id: record.userId._id, username: record.userId.username }
          : null,
      };
    })
    .filter(Boolean);
};

// Tạo từ mới
exports.createWord = async (req, res) => {
  try {
    const { englishWord, vietnameseWord, topics, level } = req.body;
    const normalizedEnglishWord = normalizeWordInput(englishWord).toLowerCase();
    const normalizedVietnameseWord = normalizeWordInput(vietnameseWord);

    if (!normalizedEnglishWord || !normalizedVietnameseWord) {
      return res.status(400).json({ message: 'Both englishWord and vietnameseWord are required' });
    }

    if (normalizedEnglishWord) {
      // Kiểm tra từ đã tồn tại theo englishWord khi có cung cấp
      const existingWord = await Word.findOne({ englishWord: normalizedEnglishWord });
      if (existingWord) {
        return res.status(400).json({ message: 'Word already exists' });
      }
    }

    // Chỉ enrichment khi có englishWord để tránh gọi API không hợp lệ.
    const enrichedData = normalizedEnglishWord
      ? await enrichWord(normalizedEnglishWord, normalizedVietnameseWord)
      : {};

    const word = new Word({
      englishWord: normalizedEnglishWord || undefined,
      vietnameseWord: normalizedVietnameseWord || '',
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
    const { sourceEntryId, sourceUserId } = req.body || {};
    const word = await Word.findById(req.params.id);
    if (!word) {
      return res.status(404).json({ message: 'Word not found' });
    }

    const isOwner = word.createdBy?.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';
    const isPublic = await UserWordProgress.exists({ wordId: word._id, isPublic: true });

    if (!isAdmin && !isOwner && !isPublic) {
      return res.status(403).json({ message: 'You can only save your own words or words that are public' });
    }

    let sourcePublicEntry = null;
    if (sourceEntryId) {
      sourcePublicEntry = await UserWordProgress.findOne({
        _id: sourceEntryId,
        wordId: word._id,
        isPublic: true,
      });

      if (!sourcePublicEntry) {
        return res.status(400).json({ message: 'Source public entry not found' });
      }
    } else if (sourceUserId) {
      // Backward compatibility for FE that still sends sourceUserId.
      sourcePublicEntry = await UserWordProgress.findOne({
        userId: sourceUserId,
        wordId: word._id,
        isPublic: true,
      });

      if (!sourcePublicEntry) {
        return res.status(400).json({ message: 'Source public entry not found' });
      }
    }

    const result = await UserWordProgress.updateOne(
      { userId: req.user.id, wordId: word._id },
      {
        $setOnInsert: {
          level: sourcePublicEntry?.level || word.level || 3,
          addedAt: new Date(),
          personalEnglishWord: sourcePublicEntry?.personalEnglishWord || '',
          personalVietnameseWord: sourcePublicEntry?.personalVietnameseWord || '',
          personalNote: sourcePublicEntry?.personalNote || '',
          personalTags: Array.isArray(sourcePublicEntry?.personalTags) ? sourcePublicEntry.personalTags : [],
          isPublic: false,
        },
      },
      { upsert: true }
    );

    const isAddedNow = result.upsertedCount > 0;
    return res.json({
      message: isAddedNow ? 'Word added to your vocabulary' : 'Word already exists in your vocabulary',
      wordId: word._id,
      isPublic: false,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.removeFromMyVocabulary = async (req, res) => {
  try {
    const { wordId } = req.params;

    const result = await UserWordProgress.deleteOne({
      userId: req.user.id,
      wordId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Word is not in your vocabulary' });
    }

    return res.json({ message: 'Word removed from your vocabulary', wordId });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateMyVocabularyEntry = async (req, res) => {
  try {
    const { wordId } = req.params;
    const {
      personalLevel,
      level,
      personalNote,
      personalTags,
      englishWord,
      vietnameseWord,
      isPublic,
    } = req.body;

    const nextLevel = personalLevel ?? level;
    if (nextLevel !== undefined) {
      const parsedLevel = parseInt(nextLevel, 10);
      if (Number.isNaN(parsedLevel) || parsedLevel < 1 || parsedLevel > 6) {
        return res.status(400).json({ message: 'personalLevel must be an integer from 1 to 6' });
      }
    }

    if (personalTags !== undefined && !Array.isArray(personalTags)) {
      return res.status(400).json({ message: 'personalTags must be an array of strings' });
    }

    if (isPublic !== undefined && typeof isPublic !== 'boolean') {
      return res.status(400).json({ message: 'isPublic must be a boolean' });
    }

    if (englishWord !== undefined && !normalizeWordInput(englishWord)) {
      return res.status(400).json({ message: 'englishWord cannot be empty when provided' });
    }

    if (vietnameseWord !== undefined && !normalizeWordInput(vietnameseWord)) {
      return res.status(400).json({ message: 'vietnameseWord cannot be empty when provided' });
    }

    const updateData = {};
    if (nextLevel !== undefined) {
      updateData.level = parseInt(nextLevel, 10);
    }
    if (personalNote !== undefined) {
      updateData.personalNote = normalizeWordInput(personalNote);
    }
    if (personalTags !== undefined) {
      updateData.personalTags = personalTags
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (englishWord !== undefined) {
      updateData.personalEnglishWord = normalizeWordInput(englishWord).toLowerCase();
    }
    if (vietnameseWord !== undefined) {
      updateData.personalVietnameseWord = normalizeWordInput(vietnameseWord);
    }
    if (isPublic !== undefined) {
      updateData.isPublic = isPublic;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No update fields provided' });
    }

    const progress = await UserWordProgress.findOneAndUpdate(
      { userId: req.user.id, wordId },
      { $set: updateData },
      { new: true }
    ).populate({ path: 'wordId', populate: { path: 'createdBy', select: 'username' } });

    if (!progress || !progress.wordId) {
      return res.status(404).json({ message: 'Word is not in your vocabulary' });
    }

    return res.json({
      message: 'My vocabulary entry updated',
      word: buildWordFromProgress(progress),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getCommunityWords = async (req, res) => {
  try {
    const count = toPositiveInt(req.query.count, 20);
    const { topic } = req.query;
    const level = req.query.level !== undefined ? parseInt(req.query.level, 10) : undefined;

    if (level !== undefined && (Number.isNaN(level) || level < 1 || level > 6)) {
      return res.status(400).json({ message: 'level must be an integer from 1 to 6' });
    }

    const words = await getCommunityWords({ count, topic, level });
    return res.json({ words, count: words.length });
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

    const selected = pickWeightedByLevel(words, count);
    return res.json(
      buildReviewResponse({
        mode: mineOnly && req.user?.id ? 'my-vocabulary' : 'public',
        filterType: 'topic',
        filterValue: topic,
        candidates: words,
        selected,
      })
    );
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

    const selected = pickWeightedByLevel(words, count);
    return res.json(
      buildReviewResponse({
        mode: mineOnly && req.user?.id ? 'my-vocabulary' : 'public',
        filterType: 'level',
        filterValue: level,
        candidates: words,
        selected,
      })
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.getMyVocabulary = async (req, res) => {
  try {
    const count = toPositiveInt(req.query.count, 10);
    const words = await getMyVocabularyWords(req.user.id, count);

    return res.json({
      words,
      count: words.length,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.reviewMyVocabByTopic = async (req, res) => {
  try {
    const { topic } = req.query;
    const count = toPositiveInt(req.query.count, 10);

    if (!topic) {
      return res.status(400).json({ message: 'topic is required' });
    }

    const words = await getUserProgressWordsByTopic(req.user.id, topic);
    const selected = pickWeightedByLevel(words, count);

    return res.json(
      buildReviewResponse({
        mode: 'my-vocabulary',
        filterType: 'topic',
        filterValue: topic,
        candidates: words,
        selected,
      })
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.reviewMyVocabByLevel = async (req, res) => {
  try {
    const level = parseInt(req.query.level, 10);
    const count = toPositiveInt(req.query.count, 10);

    if (Number.isNaN(level) || level < 1 || level > 6) {
      return res.status(400).json({ message: 'level must be an integer from 1 to 6' });
    }

    const words = await getUserProgressWordsByLevel(req.user.id, level);
    const selected = pickWeightedByLevel(words, count);

    return res.json(
      buildReviewResponse({
        mode: 'my-vocabulary',
        filterType: 'level',
        filterValue: level,
        candidates: words,
        selected,
      })
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Lấy tất cả từ
exports.getAllWords = async (req, res) => {
  try {
    const { level, topic, limit = 20, skip = 0 } = req.query;
    const accessQuery = await buildAccessQueryForWords(req.user);
    const queryConditions = [];

    if (Object.keys(accessQuery).length > 0) {
      queryConditions.push(accessQuery);
    }

    if (level) queryConditions.push({ level: parseInt(level, 10) });
    if (topic) queryConditions.push({ topics: topic });

    const query = queryConditions.length > 0 ? { $and: queryConditions } : {};

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

    const canAccess = await canUserAccessWord(req.user, word);
    if (!canAccess) {
      return res.status(403).json({ message: 'You do not have permission to access this word' });
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

    console.log('[recordInteraction] request_received', {
      userId: req.user?.id,
      wordId,
      isCorrect,
      timestamp: new Date().toISOString(),
    });

    if (typeof isCorrect !== 'boolean') {
      console.warn('[recordInteraction] invalid_payload', {
        userId: req.user?.id,
        wordId,
        isCorrect,
      });
      return res.status(400).json({ message: 'isCorrect must be a boolean' });
    }

    const word = await Word.findById(wordId);
    if (!word) {
      console.warn('[recordInteraction] word_not_found', {
        userId: req.user?.id,
        wordId,
      });
      return res.status(404).json({ message: 'Word not found' });
    }

    // Lưu tương tác
    const interaction = new Interaction({
      userId: req.user.id,
      wordId: wordId,
      isCorrect: isCorrect
    });
    await interaction.save();

    console.log('[recordInteraction] interaction_saved', {
      interactionId: interaction._id,
      userId: req.user?.id,
      wordId,
      isCorrect,
    });

    const progress = await UserWordProgress.findOneAndUpdate(
      { userId: req.user.id, wordId: wordId },
      {
        $setOnInsert: {
          level: word.level || 3,
          addedAt: new Date(),
          isPublic: false,
          correctStreak: 0,
          incorrectStreak: 0,
        },
      },
      { upsert: true, new: true }
    );

    const previousLevel = progress.level || word.level || 3;

    if (typeof progress.correctStreak !== 'number') progress.correctStreak = 0;
    if (typeof progress.incorrectStreak !== 'number') progress.incorrectStreak = 0;

    // Rule mới:
    // - Sai 3 lần liên tiếp mới tăng level.
    // - Đúng 5 lần liên tiếp mới giảm level.
    if (isCorrect === false) {
      progress.incorrectStreak += 1;
      progress.correctStreak = 0;

      if (progress.incorrectStreak >= 3) {
        progress.level = Math.min(6, progress.level + 1);
        progress.incorrectStreak = 0;
      }
    } else {
      progress.correctStreak += 1;
      progress.incorrectStreak = 0;

      if (progress.correctStreak >= 5) {
        progress.level = Math.max(1, progress.level - 1);
        progress.correctStreak = 0;
      }
    }

    progress.lastReviewedAt = new Date();
    await progress.save();

    const [totalInteractions, totalCorrect, totalIncorrect] = await Promise.all([
      Interaction.countDocuments({ userId: req.user.id, wordId }),
      Interaction.countDocuments({ userId: req.user.id, wordId, isCorrect: true }),
      Interaction.countDocuments({ userId: req.user.id, wordId, isCorrect: false }),
    ]);

    console.log('[recordInteraction] progress_updated', {
      userId: req.user?.id,
      wordId,
      previousLevel,
      level: progress.level,
      correctStreak: progress.correctStreak,
      incorrectStreak: progress.incorrectStreak,
      totalInteractions,
      totalCorrect,
      totalIncorrect,
      lastReviewedAt: progress.lastReviewedAt,
    });

    res.json({
      message: 'Interaction recorded',
      wordId,
      isCorrect,
      previousLevel,
      newLevel: progress.level,
      correctStreak: progress.correctStreak,
      incorrectStreak: progress.incorrectStreak,
      totalInteractions,
      totalCorrect,
      totalIncorrect,
      reviewedAt: progress.lastReviewedAt,
    });
  } catch (error) {
    console.error('[recordInteraction] unexpected_error', {
      userId: req.user?.id,
      wordId: req.params?.id,
      message: error.message,
    });
    res.status(500).json({ message: error.message });
  }
};

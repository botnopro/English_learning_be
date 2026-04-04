require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const User = require('../models/User');
const Word = require('../models/Word');
const UserWordProgress = require('../models/UserWordProgress');

const SHEET_PATH = path.join(__dirname, '..', 'data', 'seed_words_sheet.csv');

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function toList(value) {
  if (!value) return [];
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function getSeedUser() {
  const email = process.env.SEED_ADMIN_EMAIL || 'seed.admin@example.com';
  const username = process.env.SEED_ADMIN_USERNAME || 'seed_admin';
  const password = process.env.SEED_ADMIN_PASSWORD || 'seedadmin123';

  let user = await User.findOne({ email });
  if (!user) {
    user = new User({
      username,
      email,
      password,
      role: 'admin',
    });
    await user.save();
    console.log(`Created seed admin user: ${email}`);
  }

  return user;
}

async function cleanupLegacyIndexes() {
  const indexes = await Word.collection.indexes();
  const legacyWordIndex = indexes.find((idx) => idx.key && idx.key.word === 1);
  const legacyEnglishWordUniqueIndex = indexes.find(
    (idx) => idx.key && idx.key.englishWord === 1 && idx.unique && !idx.partialFilterExpression
  );

  if (legacyWordIndex) {
    await Word.collection.dropIndex(legacyWordIndex.name);
    console.log(`Dropped legacy index: ${legacyWordIndex.name}`);
  }

  if (legacyEnglishWordUniqueIndex) {
    await Word.collection.dropIndex(legacyEnglishWordUniqueIndex.name);
    console.log(`Dropped outdated englishWord unique index: ${legacyEnglishWordUniqueIndex.name}`);
  }

  try {
    await Word.collection.createIndex(
      { englishWord: 1 },
      {
        unique: true,
        // Some MongoDB deployments reject $ne in partial indexes.
        partialFilterExpression: { englishWord: { $exists: true, $gt: '' } },
        name: 'englishWord_1',
      }
    );
  } catch (error) {
    console.warn(`Failed to create partial unique index for englishWord: ${error.message}`);
    // Fallback: still keep a usable index so seed can continue.
    await Word.collection.createIndex({ englishWord: 1 }, { name: 'englishWord_1' });
  }
}

async function seedWords() {
  const conn = await connectDB();
  if (!conn) {
    console.error('Cannot seed words because MongoDB is not available.');
    process.exit(1);
  }

  if (!fs.existsSync(SHEET_PATH)) {
    console.error(`Seed sheet not found: ${SHEET_PATH}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(SHEET_PATH, 'utf8').trim();
  const lines = csvText.split(/\r?\n/).filter(Boolean);

  if (lines.length <= 1) {
    console.error('Seed sheet is empty.');
    process.exit(1);
  }

  const headers = parseCsvLine(lines[0]);
  const headerIndex = headers.reduce((acc, key, index) => {
    acc[key] = index;
    return acc;
  }, {});

  const requiredHeaders = ['englishWord', 'vietnameseWord'];
  const missingHeaders = requiredHeaders.filter((h) => !(h in headerIndex));
  if (missingHeaders.length > 0) {
    console.error(`Missing required headers: ${missingHeaders.join(', ')}`);
    process.exit(1);
  }

  await cleanupLegacyIndexes();

  const seedUser = await getSeedUser();

  let createdCount = 0;
  let updatedCount = 0;
  let progressCreatedCount = 0;
  let progressUpdatedCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const englishWordRaw = row[headerIndex.englishWord] || '';
    const englishWord = englishWordRaw.toLowerCase().trim();
    if (!englishWord) continue;

    const updateData = {
      vietnameseWord: (row[headerIndex.vietnameseWord] || '').trim(),
      pronunciation: (row[headerIndex.pronunciation] || '').trim(),
      partOfSpeech: (row[headerIndex.partOfSpeech] || '').trim(),
      definitions: toList(row[headerIndex.definitions]),
      examples: toList(row[headerIndex.examples]),
      synonyms: toList(row[headerIndex.synonyms]),
      topics: toList(row[headerIndex.topics]),
      level: Math.min(6, Math.max(1, Number(row[headerIndex.level]) || 3)),
      updatedAt: new Date(),
    };

    const existing = await Word.findOne({ englishWord });

    let wordId;

    if (!existing) {
      const createdWord = await Word.create({
        ...updateData,
        englishWord,
        createdBy: seedUser._id,
      });
      createdCount += 1;
      wordId = createdWord._id;
    } else {
      await Word.updateOne({ _id: existing._id }, { $set: updateData });
      updatedCount += 1;
      wordId = existing._id;
    }

    if (!wordId) {
      // Skip progress sync if word could not be resolved for any reason.
      // This avoids stopping the whole seed process for one malformed row.
      continue;
    }

    const progressResult = await UserWordProgress.updateOne(
      { userId: seedUser._id, wordId },
      {
        $set: {
          level: updateData.level,
          isPublic: true,
          personalEnglishWord: englishWord,
          personalVietnameseWord: updateData.vietnameseWord,
        },
        $setOnInsert: {
          addedAt: new Date(),
          personalNote: '',
          personalTags: [],
          correctStreak: 0,
          incorrectStreak: 0,
        },
      },
      { upsert: true }
    );

    if (progressResult.upsertedCount > 0) {
      progressCreatedCount += 1;
    } else {
      progressUpdatedCount += 1;
    }
  }

  console.log(
    `Seed completed. Words Created: ${createdCount}, Words Updated: ${updatedCount}, ` +
      `Progress Created: ${progressCreatedCount}, Progress Updated: ${progressUpdatedCount}`
  );
  await mongoose.connection.close();
}

seedWords().catch(async (error) => {
  console.error('Seed failed:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});

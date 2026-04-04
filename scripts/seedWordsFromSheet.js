require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const User = require('../models/User');
const Word = require('../models/Word');

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

  if (legacyWordIndex) {
    await Word.collection.dropIndex(legacyWordIndex.name);
    console.log(`Dropped legacy index: ${legacyWordIndex.name}`);
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

    if (!existing) {
      await Word.create({
        ...updateData,
        englishWord,
        createdBy: seedUser._id,
      });
      createdCount += 1;
    } else {
      await Word.updateOne({ _id: existing._id }, { $set: updateData });
      updatedCount += 1;
    }
  }

  console.log(`Seed completed. Created: ${createdCount}, Updated: ${updatedCount}`);
  await mongoose.connection.close();
}

seedWords().catch(async (error) => {
  console.error('Seed failed:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});

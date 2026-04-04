const mongoose = require('mongoose');

const wordSchema = new mongoose.Schema({
  englishWord: {
    type: String,
    trim: true
  },
  vietnameseWord: {
    type: String,
    trim: true
  },
  pronunciation: {
    type: String
  },
  partOfSpeech: {
    type: String
  },
  definitions: [{
    type: String
  }],
  examples: [{
    type: String
  }],
  synonyms: [{
    type: String
  }],
  level: {
    type: Number,
    enum: [1, 2, 3, 4, 5, 6],
    default: 3
  },
  topics: [{
    type: String
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isEditable: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Only enforce uniqueness when englishWord is provided and not empty.
wordSchema.index(
  { englishWord: 1 },
  {
    unique: true,
    partialFilterExpression: { englishWord: { $exists: true, $type: 'string', $ne: '' } }
  }
);

module.exports = mongoose.model('Word', wordSchema);

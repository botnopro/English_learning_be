const mongoose = require('mongoose');

const userWordProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    wordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Word',
      required: true,
      index: true,
    },
    level: {
      type: Number,
      enum: [1, 2, 3, 4, 5, 6],
      default: 3,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    lastReviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

userWordProgressSchema.index({ userId: 1, wordId: 1 }, { unique: true });

module.exports = mongoose.model('UserWordProgress', userWordProgressSchema);

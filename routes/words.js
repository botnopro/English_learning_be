const express = require('express');
const router = express.Router();
const wordController = require('../controllers/wordController');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');

// Public routes
router.get('/', wordController.getAllWords);
router.get('/review/by-topic', optionalAuthMiddleware, wordController.reviewByTopic);
router.get('/review/by-level', optionalAuthMiddleware, wordController.reviewByLevel);
router.get('/:id', wordController.getWordById);

// Protected routes
router.post('/', authMiddleware, wordController.createWord);
router.post('/:id/add-to-my-vocab', authMiddleware, wordController.addToMyVocabulary);
router.put('/:id', authMiddleware, wordController.updateWord);
router.delete('/:id', authMiddleware, wordController.deleteWord);
router.post('/:id/interact', authMiddleware, wordController.recordInteraction);

module.exports = router;

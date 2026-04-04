const express = require('express');
const router = express.Router();
const wordController = require('../controllers/wordController');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');

// Public routes
router.get('/', optionalAuthMiddleware, wordController.getAllWords);
router.get('/review/by-topic', optionalAuthMiddleware, wordController.reviewByTopic);
router.get('/review/by-level', optionalAuthMiddleware, wordController.reviewByLevel);
router.get('/community', wordController.getCommunityWords);
router.get('/public', wordController.getCommunityWords);
router.get('/my-vocab', authMiddleware, wordController.getMyVocabulary);
router.get('/my-vocab/review/by-topic', authMiddleware, wordController.reviewMyVocabByTopic);
router.get('/my-vocab/review/by-level', authMiddleware, wordController.reviewMyVocabByLevel);
router.put('/my-vocab/:wordId', authMiddleware, wordController.updateMyVocabularyEntry);
router.delete('/my-vocab/:wordId', authMiddleware, wordController.removeFromMyVocabulary);
router.get('/:id', optionalAuthMiddleware, wordController.getWordById);

// Protected routes
router.post('/', authMiddleware, wordController.createWord);
router.post('/:id/add-to-my-vocab', authMiddleware, wordController.addToMyVocabulary);
router.put('/:id', authMiddleware, wordController.updateWord);
router.delete('/:id', authMiddleware, wordController.deleteWord);
router.post('/:id/interact', authMiddleware, wordController.recordInteraction);

module.exports = router;

const express = require('express');
const router = express.Router();
const Poster = require('../model/poster');
const { uploadPosters } = require('../uploadFile');
const multer = require('multer');
const asyncHandler = require('express-async-handler');
const { protect } = require('../middleware/auth');
const { resolveTenant, requireCompany } = require('../middleware/tenant');
const { companyFilter, stampCompany } = require('../utils/tenantScope');
const { assertDocumentCompany } = require('../services/companyService');

router.use(protect, resolveTenant, requireCompany);

// --- GET ALL POSTERS ---
router.get('/', asyncHandler(async (req, res) => {
    const posters = await Poster.find({ ...companyFilter(req.companyId) });
    res.json({
        success: true,
        message: "Posters retrieved successfully.",
        data: posters
    });
}));

// --- GET A POSTER BY ID ---
router.get('/:id', asyncHandler(async (req, res) => {
    const posterID = req.params.id;
    const poster = await Poster.findById(posterID);

    if (!poster) {
        return res.status(404).json({ success: false, message: "Poster not found." });
    }
    assertDocumentCompany(poster, req.companyId, 'Poster');
    res.json({
        success: true,
        message: "Poster retrieved successfully.",
        data: poster
    });
}));

// --- CREATE A NEW POSTER ---
router.post('/', asyncHandler(async (req, res) => {
    uploadPosters.single('img')(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            const message = err.code === 'LIMIT_FILE_SIZE'
                ? 'File size is too large. Maximum filesize is 5MB.'
                : err.message;
            console.log(`Add poster Multer Error: ${message}`);
            return res.status(400).json({ success: false, message });
        } else if (err) {
            console.log(`Add poster Error: ${err.message}`);
            return res.status(500).json({ success: false, message: err.message });
        }

        const {
            posterName,
            navigationTo = 'none',
            targetId
        } = req.body;

        let imageUrl = 'no_url';
        if (req.file) {
            imageUrl = req.file.path;
        }

        if (!posterName?.trim()) {
            return res.status(400).json({ success: false, message: "Poster name is required." });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: "Image is required when creating a new poster." });
        }

        try {
            const newPoster = new Poster(stampCompany({
                posterName: posterName.trim(),
                imageUrl,
                navigationTo,
                targetId: targetId || null
            }, req.companyId));

            await newPoster.save();

            res.status(201).json({
                success: true,
                message: "Poster created successfully.",
                data: newPoster
            });
        } catch (error) {
            console.error("Error creating Poster:", error);
            res.status(500).json({ success: false, message: error.message || "Failed to create poster." });
        }
    });
}));

// --- UPDATE A POSTER ---
router.put('/:id', asyncHandler(async (req, res) => {
    const posterID = req.params.id;

    uploadPosters.single('img')(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
            const message = err.code === 'LIMIT_FILE_SIZE'
                ? 'File size is too large. Maximum filesize is 5MB.'
                : err.message;
            console.log(`Update poster Multer Error: ${message}`);
            return res.status(400).json({ success: false, message });
        } else if (err) {
            console.log(`Update poster Error: ${err.message}`);
            return res.status(500).json({ success: false, message: err.message });
        }

        const {
            posterName,
            image,
            navigationTo = 'none',
            targetId
        } = req.body;

        let imageUrl = image?.trim();
        if (req.file) {
            imageUrl = req.file.path;
        }

        if (!posterName?.trim()) {
            return res.status(400).json({ success: false, message: "Poster name is required." });
        }

        if (!imageUrl || imageUrl === 'no_url' || imageUrl === 'no_data') {
            return res.status(400).json({ success: false, message: "Image is required." });
        }

        try {
            const updatedPoster = await Poster.findOneAndUpdate(
                { _id: posterID, ...companyFilter(req.companyId) },
                {
                    posterName: posterName.trim(),
                    imageUrl,
                    navigationTo,
                    targetId: targetId || null
                },
                { new: true, runValidators: true }
            );

            if (!updatedPoster) {
                return res.status(404).json({ success: false, message: "Poster not found." });
            }

            res.json({
                success: true,
                message: "Poster updated successfully.",
                data: updatedPoster
            });
        } catch (error) {
            console.error("Error updating Poster:", error);
            res.status(500).json({ success: false, message: error.message || "Failed to update poster." });
        }
    });
}));

// --- DELETE A POSTER ---
router.delete('/:id', asyncHandler(async (req, res) => {
    const posterID = req.params.id;

    const deletedPoster = await Poster.findOneAndDelete({
        _id: posterID,
        ...companyFilter(req.companyId)
    });

    if (!deletedPoster) {
        return res.status(404).json({ success: false, message: "Poster not found." });
    }

    res.json({
        success: true,
        message: "Poster deleted successfully.",
        data: deletedPoster
    });
}));

module.exports = router;

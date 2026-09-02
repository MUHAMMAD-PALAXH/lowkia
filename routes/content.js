const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const contentService = require("../services/contentService");

router.get(
    "/blog",
    asyncHandler(async (req, res) => {
        const result = await contentService.listBlogPosts(req.query);
        return res.status(200).json({
            success: true,
            message: "Blog posts retrieved.",
            data: result.data,
            pagination: result.pagination,
            errors: null,
        });
    })
);

router.get(
    "/blog/:slug",
    asyncHandler(async (req, res) => {
        const data = await contentService.getBlogPostBySlug(
            req.params.slug,
            req.query.locale
        );
        return success(res, "Blog post retrieved.", data);
    })
);

router.get(
    "/pages/:slug",
    asyncHandler(async (req, res) => {
        const data = await contentService.getPageBySlug(
            req.params.slug,
            req.query.locale
        );
        return success(res, "Page retrieved.", data);
    })
);

module.exports = router;

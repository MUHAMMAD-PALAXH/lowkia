const mongoose = require("mongoose");

const contentPageSchema = new mongoose.Schema(
    {
        slug: { type: String, required: true, trim: true, lowercase: true },
        locale: { type: String, default: "en", trim: true, lowercase: true },
        type: {
            type: String,
            enum: ["page", "blog"],
            default: "page",
        },
        title: { type: String, required: true, trim: true },
        excerpt: { type: String, default: "", trim: true },
        body: { type: String, default: "" },
        coverImageUrl: { type: String, default: "" },
        status: {
            type: String,
            enum: ["draft", "published"],
            default: "published",
        },
        publishedAt: { type: Date, default: null },
        isDeleted: { type: Boolean, default: false },
    },
    { timestamps: true }
);

contentPageSchema.index({ slug: 1, locale: 1, type: 1 }, { unique: true });
contentPageSchema.index({ type: 1, status: 1, publishedAt: -1 });

module.exports = mongoose.model("ContentPage", contentPageSchema);

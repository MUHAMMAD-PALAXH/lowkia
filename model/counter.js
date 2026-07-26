const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema(
    {

        module: {

            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },

        prefix: {

            type: String,
            required: true,
            trim: true,
            uppercase: true
        },

        padding: {

            type: Number,
            default: 6
        },

        lastNumber: {

            type: Number,
            default: 0
        }
    },
    {

        timestamps: true,
        versionKey: false
    }
);

counterSchema.virtual("id").get(function () {

    return this._id.toHexString();
});

counterSchema.set("toJSON", {

    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {

        delete ret._id;
        return ret;
    }
});

module.exports = mongoose.model("Counter", counterSchema);

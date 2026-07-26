const mongoose = require("mongoose");

module.exports = function baseModelPlugin(schema) {

    schema.add({

        createdBy: {

            type: mongoose.Schema.Types.ObjectId,

            ref: "AdminUser",

            default: null

        },

        updatedBy: {

            type: mongoose.Schema.Types.ObjectId,

            ref: "AdminUser",

            default: null

        },

        deletedBy: {

            type: mongoose.Schema.Types.ObjectId,

            ref: "AdminUser",

            default: null

        },

        isDeleted: {

            type: Boolean,

            default: false,

            index: true

        },

        deletedAt: {

            type: Date,

            default: null

        }

    });

};

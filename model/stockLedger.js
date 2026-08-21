const mongoose = require("mongoose");
const tenantPlugin = require("./plugins/tenant.plugin");

const stockLedgerSchema = new mongoose.Schema({

    warehouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Warehouse",
        required: true
    },

    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true
    },

    transactionType: {
        type: String,
        enum: [
            "Opening Stock",
            "Purchase",
            "Purchase Return",
            "Sale",
            "Sales Return",
            "Stock Transfer In",
            "Stock Transfer Out",
            "Stock Adjustment"
        ],
        required: true
    },

    quantity: {
        type: Number,
        required: true
    },

    balanceAfterTransaction: {
        type: Number,
        required: true
    },

    unitCost: {
        type: Number,
        default: 0
    },

    referenceType: {
        type: String,
        enum: [
            "PurchaseOrder",
            "GRN",
            "SalesOrder",
            "PurchaseReturn",
            "SalesReturn",
            "StockTransfer",
            "Adjustment"
        ]
    },

    referenceId: {
        type: mongoose.Schema.Types.ObjectId
    },

    remarks: {
        type: String,
        default: ""
    },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }

}, {
    timestamps: true
});

stockLedgerSchema.plugin(tenantPlugin);

module.exports = mongoose.model("StockLedger", stockLedgerSchema);
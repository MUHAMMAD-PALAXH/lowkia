const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema(
{
    // =====================================================
    // Company Information
    // =====================================================

    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true,
        unique: true,
        index: true
    },

    companyCode: {
        type: String,
        required: true,
        trim: true,
        uppercase: true
    },



    // =====================================================
    // Organization
    // =====================================================

    branch: {
        type: Number,
        default: 0
    },

    warehouse: {
        type: Number,
        default: 0
    },

    department: {
        type: Number,
        default: 0
    },

    designation: {
        type: Number,
        default: 0
    },

    employee: {
        type: Number,
        default: 0
    },

    shift: {
        type: Number,
        default: 0
    },

    leaveType: {
        type: Number,
        default: 0
    },

    holiday: {
        type: Number,
        default: 0
    },



    // =====================================================
    // Business Partners
    // =====================================================

    supplier: {
        type: Number,
        default: 0
    },

    customer: {
        type: Number,
        default: 0
    },



    // =====================================================
    // Product Master
    // =====================================================

    category: {
        type: Number,
        default: 0
    },

    subCategory: {
        type: Number,
        default: 0
    },

    brand: {
        type: Number,
        default: 0
    },

    unit: {
        type: Number,
        default: 0
    },

    variantType: {
        type: Number,
        default: 0
    },

    variant: {
        type: Number,
        default: 0
    },

    product: {
        type: Number,
        default: 0
    },

    productVariant: {
        type: Number,
        default: 0
    },

    asset: {
        type: Number,
        default: 0
    },



    // =====================================================
    // Purchase
    // =====================================================

    purchaseOrder: {
        type: Number,
        default: 0
    },

    grn: {
        type: Number,
        default: 0
    },

    purchaseInvoice: {
        type: Number,
        default: 0
    },

    purchaseReturn: {
        type: Number,
        default: 0
    },



    // =====================================================
    // Inventory
    // =====================================================

    stockTransfer: {
        type: Number,
        default: 0
    },

    stockAdjustment: {
        type: Number,
        default: 0
    },

    stockCount: {
        type: Number,
        default: 0
    },

    damageStock: {
        type: Number,
        default: 0
    },

        // =====================================================
    // Sales
    // =====================================================

    salesQuotation: {
        type: Number,
        default: 0
    },

    salesOrder: {
        type: Number,
        default: 0
    },

    salesInvoice: {
        type: Number,
        default: 0
    },

    delivery: {
        type: Number,
        default: 0
    },

    salesReturn: {
        type: Number,
        default: 0
    },



    // =====================================================
    // Finance
    // =====================================================

    payment: {
        type: Number,
        default: 0
    },

    receipt: {
        type: Number,
        default: 0
    },

    expenseCategory: {
        type: Number,
        default: 0
    },

    expense: {
        type: Number,
        default: 0
    },

    journal: {
        type: Number,
        default: 0
    },

    ledger: {
        type: Number,
        default: 0
    },



    // =====================================================
    // CRM
    // =====================================================

    lead: {
        type: Number,
        default: 0
    },

    contact: {
        type: Number,
        default: 0
    },



    // =====================================================
    // System
    // =====================================================

    activityLog: {
        type: Number,
        default: 0
    },

    notification: {
        type: Number,
        default: 0
    }

},
{
    timestamps: true,
    versionKey: false

});


// =====================================================
// Indexes
// =====================================================

// One Counter Document Per Company
counterSchema.index(
    {
        companyId: 1
    },
    {
        unique: true
    }
);

// Company Code Index
counterSchema.index({
    companyCode: 1
});


// =====================================================
// Virtuals
// =====================================================

counterSchema.virtual("id").get(function () {

    return this._id.toHexString();

});


// =====================================================
// JSON Transform
// =====================================================

counterSchema.set("toJSON", {

    virtuals: true,

    versionKey: false,

    transform: function (doc, ret) {

        delete ret._id;

        return ret;

    }

});


// =====================================================
// Export
// =====================================================

module.exports = mongoose.model(
    "Counter",
    counterSchema
);
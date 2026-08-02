const mongoose = require("mongoose");

// ==========================================================
// Purchase Item Schema (Sub-document)
// ==========================================================

const purchaseItemSchema = new mongoose.Schema(
    {

        productId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            default: null,
            index: true
        },

        productVariantId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "ProductVariant",
            default: null
        },

        trackingType: {
            type: String,
            enum: ["IMEI", "Non-IMEI"],
            default: "Non-IMEI"
        },

        sku: {

            type: String,
            trim: true,
            default: ""
        },

        productName: {

            type: String,
            required: true,
            trim: true
        },

        variantLabel: {

            type: String,
            default: "",
            trim: true
        },

        variantAttributes: [
            {
                variantTypeId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "VariantType",
                    default: null
                },
                variantId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Variant",
                    default: null
                }
            }
        ],

        // Ordered Quantity
        quantity: {

            type: Number,
            required: true,
            min: 1
        },

        // Received from GRN
        receivedQuantity: {

            type: Number,
            default: 0,
            min: 0
        },

        // Qty supplier marked as sent (before warehouse GRN)
        supplierSentQuantity: {
            type: Number,
            default: 0,
            min: 0
        },

        // Remaining Quantity
        pendingQuantity: {

            type: Number,
            default: 0,
            min: 0
        },

        // Pricing
        purchasePrice: {

            type: Number,
            required: true,
            min: 0
        },

        discount: {

            type: Number,
            default: 0,
            min: 0
        },

        tax: {

            type: Number,
            default: 0,
            min: 0
        },

        total: {

            type: Number,
            default: 0,
            min: 0
        },

        remarks: {

            type: String,
            default: ""
        },

        // Snapshot for UI / print
        currentStock: {
            type: Number,
            default: 0
        },

        // Product-master snapshot for "New Product" purchase lines
        proCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            default: null
        },

        proSubCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubCategory",
            default: null
        },

        proBrandId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Brand",
            default: null
        },

        manufacturer: {
            type: String,
            default: ""
        },

        countryOfOrigin: {
            type: String,
            default: "Bangladesh"
        },

        hsnCode: {
            type: String,
            default: ""
        },

        warrantyType: {
            type: String,
            enum: ["No Warranty", "Days", "Months", "Years", "Lifetime"],
            default: "No Warranty"
        },

        warrantyPeriod: {
            type: Number,
            default: 0
        },

        sellingPrice: {
            type: Number,
            default: 0,
            min: 0
        },

        wholesalePrice: {
            type: Number,
            default: 0,
            min: 0
        }
    },
    {
        // Keep line ids for GRN matching later
        _id: true
    }
);

// ==========================================================
// Purchase Order Schema
// ==========================================================

const purchaseOrderSchema = new mongoose.Schema(
{

        // ==========================================================
        branchId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null,
            index: true
        },

        // Existing Product Purchase | New Product Purchase
        purchaseType: {
            type: String,
            enum: ["Existing", "New"],
            default: "Existing",
            index: true
        },

        // ==========================================================
        // Document Information
        // ==========================================================

        purchaseOrderNo: {

            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true
        },

        referenceNo: {

            type: String,
            default: "",
            trim: true
        },

        orderDate: {

            type: Date,
            default: Date.now
        },

        expectedDeliveryDate: {

            type: Date,
            default: null
        },

        // ==========================================================
        // Supplier & Warehouse
        // ==========================================================

        supplierId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
            default: null,
            index: true
        },

        warehouseId: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "Warehouse",
            default: null,
            index: true
        },

        // ======================================================
        // Products
        // ======================================================

        items: [purchaseItemSchema],

        // ======================================================
        // Financial Summary
        // ======================================================

        subtotal: {

            type: Number,
            default: 0,
            min: 0
        },

        discount: {

            type: Number,
            default: 0,
            min: 0
        },

        discountType: {
            type: String,
            enum: ["Fixed", "Percentage"],
            default: "Fixed"
        },

        tax: {

            type: Number,
            default: 0,
            min: 0
        },

        taxType: {
            type: String,
            enum: ["Fixed", "Percentage"],
            default: "Fixed"
        },

        shippingCost: {

            type: Number,
            default: 0,
            min: 0
        },

        shippingType: {
            type: String,
            enum: ["Fixed", "Percentage"],
            default: "Fixed"
        },

        otherCharges: {

            type: Number,
            default: 0,
            min: 0
        },

        grandTotal: {

            type: Number,
            default: 0,
            min: 0
        },

        // ======================================================
        // Payment Information
        // ======================================================

        paymentStatus: {

            type: String,
            enum: ["Pending", "Partial", "Paid"],
            default: "Pending"
        },

        paidAmount: {

            type: Number,
            default: 0,
            min: 0
        },

        dueAmount: {

            type: Number,
            default: 0,
            min: 0
        },

        paymentTerms: {

            type: String,
            enum: ["Cash", "7 Days", "15 Days", "30 Days", "60 Days", "90 Days", "Custom"],
            default: "Cash"
        },

        paymentDueDate: {

            type: Date,
            default: null
        },

        // ======================================================
        // Purchase Workflow Status
        // ======================================================

        status: {

            type: String,
            enum: [
                "Draft",
                "Pending Approval",
                "Approved",
                "Ordered",
                "Awaiting Supplier",
                "Supplier Accepted",
                "Supplier Rejected",
                "Partially Delivered",
                "Completely Delivered",
                "Partially Received",
                "Received",
                "Completed",
                "Cancelled"
            ],
            default: "Draft"
        },

        // ======================================================
        // GRN Integration
        // ======================================================

        grnIds: [
            {

                type: mongoose.Schema.Types.ObjectId,
                ref: "GRN"
            }
        ],

        totalReceivedAmount: {

            type: Number,
            default: 0
        },

        isFullyReceived: {

            type: Boolean,
            default: false
        },

        // ======================================================
        // Approval System
        // ======================================================

        requiresApproval: {

            type: Boolean,
            default: false
        },

        approvedBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        approvedAt: {

            type: Date,
            default: null
        },

        rejectionReason: {

            type: String,
            default: ""
        },

        rejectedBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        rejectedAt: {

            type: Date,
            default: null
        },

        // ======================================================
        // Notes
        // ======================================================

        supplierNote: {

            type: String,
            default: ""
        },

        // ======================================================
        // Supplier acceptance (only when supplierId is set)
        // ======================================================

        supplierAcceptanceStatus: {
            type: String,
            enum: ["Not Required", "Pending", "Accepted", "Rejected", "Withdrawn"],
            default: "Not Required"
        },

        supplierNotifiedAt: {
            type: Date,
            default: null
        },

        supplierMessage: {
            type: String,
            default: ""
        },

        supplierRespondedAt: {
            type: Date,
            default: null
        },

        supplierResponseNote: {
            type: String,
            default: ""
        },

        supplierExpectedDeliveryDate: {
            type: Date,
            default: null
        },

        supplierDeliveryType: {
            type: String,
            enum: ["Full", "Partial", ""],
            default: ""
        },

        supplierPaymentType: {
            type: String,
            enum: [
                "",
                "Advance Full",
                "Advance Partial",
                "Partial",
                "Cash on Delivery",
                "Cash on Delivery Partially",
                "After Delivery"
            ],
            default: ""
        },

        supplierPaymentMethod: {
            type: String,
            enum: [
                "",
                "Cash",
                "Bank",
                "Mobile Banking",
                "Cheque",
                "Card",
                "Other",
                "Cash on Delivery"
            ],
            default: ""
        },

        supplierPartialSchedule: [
            {
                phase: { type: Number, default: 1, min: 1 },
                amount: { type: Number, default: 0, min: 0 },
                amountType: {
                    type: String,
                    enum: ["Fixed", "Percentage"],
                    default: "Fixed"
                },
                daysFrom: { type: Number, default: 0, min: 0 },
                daysTo: { type: Number, default: 0, min: 0 },
                days: { type: Number, default: 0, min: 0 },
                dateFrom: { type: Date, default: null },
                dateTo: { type: Date, default: null },
                dueDate: { type: Date, default: null },
                note: { type: String, default: "", trim: true },
                isCompleted: { type: Boolean, default: false },
                completedAt: { type: Date, default: null },
                lineAllocations: [
                    {
                        productId: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: "Product",
                            default: null
                        },
                        productVariantId: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: "ProductVariant",
                            default: null
                        },
                        productName: { type: String, default: "" },
                        variantLabel: { type: String, default: "" },
                        sku: { type: String, default: "" },
                        quantity: { type: Number, default: 0, min: 0 },
                        sentQuantity: { type: Number, default: 0, min: 0 }
                    }
                ]
            }
        ],

        supplierShipments: [
            {
                sentAt: { type: Date, default: Date.now },
                transferDaysMin: { type: Number, default: 0, min: 0 },
                transferDaysMax: { type: Number, default: 0, min: 0 },
                deliveryMode: {
                    type: String,
                    enum: ["Full", "Partial"],
                    default: "Full"
                },
                phase: { type: Number, default: null },
                varianceReason: { type: String, default: "", trim: true },
                note: { type: String, default: "", trim: true },
                lines: [
                    {
                        productId: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: "Product",
                            default: null
                        },
                        productVariantId: {
                            type: mongoose.Schema.Types.ObjectId,
                            ref: "ProductVariant",
                            default: null
                        },
                        productName: { type: String, default: "" },
                        variantLabel: { type: String, default: "" },
                        sku: { type: String, default: "" },
                        quantity: { type: Number, default: 0, min: 0 },
                        expectedQuantity: { type: Number, default: 0, min: 0 }
                    }
                ]
            }
        ],

        supplierPaymentSchedule: [
            {
                phase: { type: Number, default: 1, min: 1 },
                amount: { type: Number, default: 0, min: 0 },
                amountType: {
                    type: String,
                    enum: ["Fixed", "Percentage"],
                    default: "Fixed"
                },
                days: { type: Number, default: 0, min: 0 },
                dueDate: { type: Date, default: null },
                method: {
                    type: String,
                    enum: [
                        "",
                        "Cash",
                        "Bank",
                        "Mobile Banking",
                        "Cheque",
                        "Card",
                        "Other",
                        "Cash on Delivery"
                    ],
                    default: ""
                },
                note: { type: String, default: "", trim: true },
                isPaid: { type: Boolean, default: false },
                paidAmount: { type: Number, default: 0, min: 0 },
                paidAt: { type: Date, default: null },
                paidBy: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "AdminUser",
                    default: null
                },
                paymentRef: { type: String, default: "", trim: true },
                paymentNote: { type: String, default: "", trim: true }
            }
        ],

        internalNote: {

            type: String,
            default: ""
        },

        // ======================================================
        // Attachment
        // ======================================================

        attachments: [
            {

                fileName: {

                    type: String,
                    default: ""
                },
                fileUrl: {

                    type: String,
                    default: ""
                },
                uploadedAt: {

                    type: Date,
                    default: Date.now
                }
            }
        ],

        // ======================================================
        // Audit Information
        // ======================================================

        createdBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            required: true
        },

        updatedBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        cancelledBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        },

        cancelledAt: {

            type: Date,
            default: null
        },

        // ======================================================
        // Soft Delete
        // ======================================================

        isDeleted: {

            type: Boolean,
            default: false
        },

        deletedAt: {

            type: Date,
            default: null
        },

        deletedBy: {

            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null
        }
    },
    {

        timestamps: true,
        versionKey: false
    }
);

// ==========================================================
// INDEXES
// ==========================================================

purchaseOrderSchema.index({ purchaseOrderNo: 1 }, {

        unique: true
    });

purchaseOrderSchema.index({

    supplierId: 1,
    orderDate: -1
});

purchaseOrderSchema.index({

    warehouseId: 1,
    orderDate: -1
});

purchaseOrderSchema.index({

    branchId: 1,
    status: 1
});

purchaseOrderSchema.index({

    status: 1,
    createdAt: -1
});

purchaseOrderSchema.index({ paymentStatus: 1 });

purchaseOrderSchema.index({ expectedDeliveryDate: 1 });

// ==========================================================
// INSTANCE METHODS
// ==========================================================

// Calculate Purchase Total
purchaseOrderSchema.methods.calculateTotal = function () {

    this.subtotal = 0;

    this.items.forEach((item) => {

        item.total =
            item.quantity * item.purchasePrice - item.discount + item.tax;

        this.subtotal += item.total;

        item.pendingQuantity = item.quantity - item.receivedQuantity;
    });

    this.grandTotal =
        this.subtotal -
        this.discount +
        this.tax +
        this.shippingCost +
        this.otherCharges;

    this.dueAmount = this.grandTotal - this.paidAmount;

    return this.grandTotal;
};

// Approve Purchase Order
purchaseOrderSchema.methods.approve = function (userId) {

    this.status = "Approved";
    this.approvedBy = userId;
    this.approvedAt = new Date();
    return this.save();
};

// Reject Purchase Order
purchaseOrderSchema.methods.reject = function (userId, reason) {

    this.status = "Cancelled";
    this.rejectedBy = userId;
    this.rejectionReason = reason;
    this.rejectedAt = new Date();
    return this.save();
};

// Receive Update — never overwrite supplier-acceptance statuses with Ordered
purchaseOrderSchema.methods.updateReceivingStatus = function () {

    let totalQuantity = 0;
    let receivedQuantity = 0;

    this.items.forEach((item) => {

        totalQuantity += item.quantity;
        receivedQuantity += item.receivedQuantity;
    });

    if (receivedQuantity === 0) {
        // Keep approval / supplier-acceptance workflow statuses until GRN starts
        const keep = [
            "Draft",
            "Pending Approval",
            "Approved",
            "Awaiting Supplier",
            "Supplier Accepted",
            "Supplier Rejected",
            "Partially Delivered",
            "Completely Delivered"
        ];
        if (!keep.includes(this.status)) {
            this.status = this.supplierId ? "Ordered" : "Ordered";
        }
        this.isFullyReceived = false;
    } else if (receivedQuantity < totalQuantity) {

        this.status = "Partially Received";
        this.isFullyReceived = false;
    } else {

        this.status = "Completed";
        this.isFullyReceived = true;
    }

    return this.save();
};

// Cancel Purchase Order
purchaseOrderSchema.methods.cancel = function (userId) {

    this.status = "Cancelled";
    this.cancelledBy = userId;
    this.cancelledAt = new Date();
    return this.save();
};

// ==========================================================
// STATIC METHODS
// ==========================================================

// All Purchase Orders
purchaseOrderSchema.statics.getAllOrders = function() {

    return this.find({
        isDeleted: false
    }).sort({

        createdAt: -1
    });
};

// Pending Approval
purchaseOrderSchema.statics.getPendingApproval = function() {

    return this.find({
        status: "Pending Approval",
        isDeleted: false
    });
};

// Supplier Purchase History
purchaseOrderSchema.statics.getSupplierHistory = function (supplierId) {

    return this.find({

        supplierId,
        isDeleted: false
    }).sort({

        orderDate: -1
    });
};

// ==========================================================
// QUERY HELPERS
// ==========================================================

purchaseOrderSchema.query.active = function () {

    return this.where({

        isDeleted: false
    });
};

purchaseOrderSchema.query.pending = function () {

    return this.where({

        status: "Pending Approval"
    });
};

// ==========================================================
// JSON CONFIG
// ==========================================================

purchaseOrderSchema.set("toJSON", {

    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) {

        delete ret._id;
        return ret;
    }
});

// ==========================================================
// EXPORT
// ==========================================================

module.exports = mongoose.model("PurchaseOrder", purchaseOrderSchema);
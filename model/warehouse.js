const mongoose = require("mongoose");

const WAREHOUSE_TYPES = [
    "Main Warehouse",
    "Branch Warehouse",
    "Return Warehouse",
    "Damage Warehouse",
    "Transit Warehouse",
    "Production Warehouse"
];

const CAPACITY_UNITS = [
    "Piece",
    "Box",
    "Kg",
    "Ton",
    "Liter",
    "Pallet",
    "Container"
];

const STATUSES = ["Active", "Inactive", "Closed", "Maintenance"];

const warehouseSchema = new mongoose.Schema(
    {
        // Legacy primary branch (optional)
        branchId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            default: null
        },

        // Many-to-many branches
        branchIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Branch"
            }
        ],

        warehouseCode: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true
        },

        warehouseName: {
            type: String,
            required: true,
            trim: true
        },

        warehouseType: {
            type: String,
            enum: WAREHOUSE_TYPES,
            default: "Main Warehouse"
        },

        isDefault: {
            type: Boolean,
            default: false,
            index: true
        },

        parentWarehouseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Warehouse",
            default: null
        },

        // Text manager fields (Phase 1) + optional Employee link later
        managerName: {
            type: String,
            default: "",
            trim: true
        },

        managerPhone: {
            type: String,
            default: "",
            trim: true
        },

        managerEmail: {
            type: String,
            default: "",
            lowercase: true,
            trim: true
        },

        warehouseManagerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Employee",
            default: null
        },

        contactPhone: {
            type: String,
            default: ""
        },

        contactEmail: {
            type: String,
            lowercase: true,
            default: ""
        },

        country: {
            type: String,
            default: "Bangladesh",
            trim: true
        },

        city: {
            type: String,
            required: true,
            trim: true
        },

        postalCode: {
            type: String,
            default: ""
        },

        fullAddress: {
            type: String,
            required: true,
            trim: true
        },

        latitude: {
            type: Number
        },

        longitude: {
            type: Number
        },

        capacity: {
            type: Number,
            default: 0,
            min: 0
        },

        capacityUnit: {
            type: String,
            enum: CAPACITY_UNITS,
            default: "Piece"
        },

        currentUtilization: {
            type: Number,
            default: 0,
            min: 0
        },

        availableCapacity: {
            type: Number,
            default: 0,
            min: 0
        },

        status: {
            type: String,
            enum: STATUSES,
            default: "Active",
            index: true
        },

        openingDate: {
            type: Date,
            default: Date.now
        },

        description: {
            type: String,
            default: ""
        },

        totalProducts: {
            type: Number,
            default: 0
        },

        totalStockQuantity: {
            type: Number,
            default: 0
        },

        totalStockValue: {
            type: Number,
            default: 0
        },

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
    },
    {
        timestamps: true,
        versionKey: false
    }
);

warehouseSchema.index({ warehouseName: 1 });
warehouseSchema.index({ branchIds: 1 });
warehouseSchema.index({ parentWarehouseId: 1 });
warehouseSchema.index({ isDeleted: 1, status: 1 });

warehouseSchema.methods.updateCapacity = function (stockQuantity) {
    this.currentUtilization = stockQuantity;
    this.availableCapacity = Math.max(this.capacity - stockQuantity, 0);
    return this.save();
};

warehouseSchema.statics.getActiveWarehouses = function () {
    return this.find({
        status: "Active",
        isDeleted: { $ne: true }
    }).sort({ warehouseName: 1 });
};

warehouseSchema.query.active = function () {
    return this.where({
        status: "Active",
        isDeleted: { $ne: true }
    });
};

warehouseSchema.set("toJSON", {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model("Warehouse", warehouseSchema);
module.exports.WAREHOUSE_TYPES = WAREHOUSE_TYPES;
module.exports.CAPACITY_UNITS = CAPACITY_UNITS;
module.exports.STATUSES = STATUSES;

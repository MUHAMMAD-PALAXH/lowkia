const mongoose = require("mongoose");

const companySchema = new mongoose.Schema(
  {
    companyCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    companyName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    legalName: {
      type: String,
      default: "",
      trim: true,
    },

    businessType: {
      type: String,
      enum: [
        "Retail",
        "Wholesale",
        "Manufacturer",
        "Distributor",
        "Marketplace",
        "Service",
        "Other",
      ],
      default: "Retail",
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    website: {
      type: String,
      default: "",
      trim: true,
    },

    taxNumber: {
      type: String,
      default: "",
      trim: true,
    },

    tradeLicense: {
      type: String,
      default: "",
      trim: true,
    },

    currency: {
      type: String,
      default: "BDT",
    },

    timezone: {
      type: String,
      default: "Asia/Dhaka",
    },

    country: {
      type: String,
      default: "Bangladesh",
    },

    city: {
      type: String,
      required: true,
    },

    address: {
      type: String,
      required: true,
    },

    postalCode: {
      type: String,
      default: "",
    },

    logo: {
      type: String,
      default: "",
    },

    subscriptionPlan: {
      type: String,
      enum: [
        "Free",
        "Basic",
        "Professional",
        "Enterprise",
      ],
      default: "Free",
    },

    subscriptionStatus: {
      type: String,
      enum: [
        "Trial",
        "Active",
        "Expired",
        "Suspended",
      ],
      default: "Trial",
    },

    trialEndsAt: {
      type: Date,
      default: null,
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },

    employees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AdminUser",
      },
    ],

    totalBranches: {
      type: Number,
      default: 0,
    },

    totalWarehouses: {
      type: Number,
      default: 0,
    },

    totalSuppliers: {
      type: Number,
      default: 0,
    },

    totalProducts: {
      type: Number,
      default: 0,
    },

    totalCustomers: {
      type: Number,
      default: 0,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

companySchema.index({
  ownerId: 1,
  companyName: 1,
});

companySchema.index({
  companyCode: 1,
});

module.exports = mongoose.model("Company", companySchema);
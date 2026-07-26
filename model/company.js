const mongoose = require("mongoose");

const companySchema = new mongoose.Schema(
  {
    companyCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    companyName: {
      type: String,
      required: true,
      trim: true,
      unique: true,
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
      unique: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
    },

    website: {
      type: String,
      default: "",
    },

    taxNumber: {
      type: String,
      default: "",
    },

    tradeLicense: {
      type: String,
      default: "",
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

    // ✅ FIXED: Correctly configured nested logo object
    logo: {
      url: {
        type: String,
        default: "",
      },
    },

    subscriptionPlan: {
      type: String,
      enum: ["Free", "Basic", "Professional", "Enterprise"],
      default: "Free",
    },

    subscriptionStatus: {
      type: String,
      enum: ["Trial", "Active", "Expired", "Suspended"],
      default: "Trial",
    },

    trialEndsAt: {
      type: Date,
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    defaultBranch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
    },

    defaultWarehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },

    settings: {
      fiscalYearStart: {
        type: Number,
        default: 7,
      },

      dateFormat: {
        type: String,
        default: "DD-MM-YYYY",
      },

      invoicePrefix: {
        type: String,
        default: "INV",
      },

      poPrefix: {
        type: String,
        default: "PO",
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

companySchema.index({ companyName: 1 });
companySchema.index({ ownerId: 1 });

module.exports = mongoose.model("Company", companySchema);
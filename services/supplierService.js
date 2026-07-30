const mongoose = require("mongoose");
const Supplier = require("../model/supplier");
const { generateSupplierCode } = require("./codeGenerator");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

const trash = createTrashOps(Supplier, {
    label: "Supplier",
    nameField: "name",
    softDeleteExtra: (doc) => {
        doc.status = "Inactive";
    },
    restoreStatus: "Active",
    scopeStatusMap: {
        active: "Active",
        inactive: "Inactive",
        blocked: "Blocked"
    }
});

// Fields clients must never overwrite directly
const PROTECTED_FIELDS = [
    "supplierCode",
    "totalPurchaseAmount",
    "totalPaidAmount",
    "totalDueAmount",
    "currentBalance",
    "rating",
    "ratingCount",
    "ledgerAccountId",
    "supplierLedgerId",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "approvedBy",
    "approvedAt",
    "isApproved",
    "createdBy",
    "createdAt",
    "updatedAt"
];

const escapeRegex = (value = "") => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const pickUpdatableFields = (payload = {}) => {
    const data = { ...payload };

    // Backward-compatible alias from older clients
    if (!data.companyName && data.company) {
        data.companyName = data.company;
    }
    delete data.company;
    delete data.supplierId;

    PROTECTED_FIELDS.forEach((field) => {
        delete data[field];
    });
    return data;
};

const findActiveSupplierOrFail = trash.findActiveOrFail;

// ==========================================================
// Create Supplier
// ==========================================================

const createSupplier = async (payload, actorId = null) => {
    const name = payload.name?.trim();

    if (!name) {
        throw new AppError("Supplier name is required.", 400);
    }

    const duplicate = await Supplier.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        isDeleted: false
    });

    if (duplicate) {
        throw new AppError("Supplier with this name already exists.", 409);
    }

    if (payload.email) {
        const emailExists = await Supplier.findOne({
            email: payload.email.toLowerCase().trim(),
            isDeleted: false
        });

        if (emailExists) {
            throw new AppError("Supplier with this email already exists.", 409);
        }
    }

    if (payload.phone) {
        const phoneExists = await Supplier.findOne({
            phone: payload.phone.trim(),
            isDeleted: false
        });

        if (phoneExists) {
            throw new AppError("Supplier with this phone already exists.", 409);
        }
    }

    const supplierCode = await generateSupplierCode();
    const data = pickUpdatableFields(payload);

    const supplier = await Supplier.create({
        ...data,
        name,
        supplierCode,
        openingBalance: data.openingBalance || 0,
        currentBalance: data.openingBalance || 0,
        createdBy: actorId || null
    });

    return supplier;
};

// ==========================================================
// List Suppliers (pagination + filters)
// ==========================================================

const getSuppliers = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);

    const filter = trashMode ? { isDeleted: true } : { isDeleted: false };

    if (query.status) {
        filter.status = query.status;
    }

    if (query.supplierType) {
        filter.supplierType = query.supplierType;
    }

    if (query.isApproved !== undefined) {
        filter.isApproved =
            query.isApproved === true ||
            query.isApproved === "true";
    }

    if (query.search) {
        const search = query.search.trim();
        filter.$or = [
            { name: { $regex: search, $options: "i" } },
            { companyName: { $regex: search, $options: "i" } },
            { supplierCode: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } }
        ];
    }

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        Supplier.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .populate("createdBy", "firstName lastName email")
            .populate("updatedBy", "firstName lastName email")
            .populate("approvedBy", "firstName lastName email"),
        Supplier.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        },
        trash: trashMode
    };
};

// ==========================================================
// Get Single Supplier
// ==========================================================

const getSupplierById = async (id) => {
    const supplier = await findActiveSupplierOrFail(id);

    await supplier.populate([
        { path: "createdBy", select: "firstName lastName email" },
        { path: "updatedBy", select: "firstName lastName email" },
        { path: "approvedBy", select: "firstName lastName email" }
    ]);

    return supplier;
};

// ==========================================================
// Update Supplier
// ==========================================================

const updateSupplier = async (id, payload, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);
    const data = pickUpdatableFields(payload);

    if (data.name) {
        const name = data.name.trim();
        const duplicate = await Supplier.findOne({
            _id: { $ne: id },
            name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
            isDeleted: false
        });

        if (duplicate) {
            throw new AppError("Supplier with this name already exists.", 409);
        }

        data.name = name;
    }

    if (data.email) {
        const emailExists = await Supplier.findOne({
            _id: { $ne: id },
            email: data.email.toLowerCase().trim(),
            isDeleted: false
        });

        if (emailExists) {
            throw new AppError("Supplier with this email already exists.", 409);
        }
    }

    if (data.phone) {
        const phoneExists = await Supplier.findOne({
            _id: { $ne: id },
            phone: data.phone.trim(),
            isDeleted: false
        });

        if (phoneExists) {
            throw new AppError("Supplier with this phone already exists.", 409);
        }
    }

    Object.assign(supplier, data);
    supplier.updatedBy = actorId || supplier.updatedBy;
    await supplier.save();

    return supplier;
};

// ==========================================================
// Soft Delete
// ==========================================================

const deleteSupplier = (id, actorId = null) => trash.softDelete(id, actorId);
const restoreSupplier = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeleteSupplier = (id) => trash.permanentDelete(id);
const bulkDeleteSuppliers = (payload, actorId) =>
    trash.bulkSoftDelete(payload, actorId);
const bulkRestoreSuppliers = (payload, actorId) =>
    trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteSuppliers = (payload) =>
    trash.bulkPermanentDelete(payload);

const getSupplierStats = async () => {
    const [[rows], trashCount] = await Promise.all([
        Supplier.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    active: {
                        $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] }
                    },
                    inactive: {
                        $sum: {
                            $cond: [{ $eq: ["$status", "Inactive"] }, 1, 0]
                        }
                    },
                    blocked: {
                        $sum: { $cond: [{ $eq: ["$status", "Blocked"] }, 1, 0] }
                    },
                    approved: {
                        $sum: { $cond: ["$isApproved", 1, 0] }
                    },
                    pendingApproval: {
                        $sum: { $cond: ["$isApproved", 0, 1] }
                    },
                    dueAmount: { $sum: "$totalDueAmount" }
                }
            }
        ]),
        trash.trashCount()
    ]);

    return {
        ...(rows || {
            total: 0,
            active: 0,
            inactive: 0,
            blocked: 0,
            approved: 0,
            pendingApproval: 0,
            dueAmount: 0
        }),
        trashCount
    };
};

// ==========================================================
// Approve
// ==========================================================

const approveSupplier = async (id, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);

    if (supplier.isApproved) {
        throw new AppError("Supplier is already approved.", 400);
    }

    supplier.isApproved = true;
    supplier.approvedBy = actorId || null;
    supplier.approvedAt = new Date();
    supplier.updatedBy = actorId || null;

    if (supplier.status === "Inactive") {
        supplier.status = "Active";
    }

    await supplier.save();
    return supplier;
};

// ==========================================================
// Status Actions
// ==========================================================

const blockSupplier = async (id, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);
    supplier.status = "Blocked";
    supplier.updatedBy = actorId || null;
    await supplier.save();
    return supplier;
};

const activateSupplier = async (id, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);

    if (supplier.status === "Active") {
        throw new AppError("Supplier is already active.", 400);
    }

    supplier.status = "Active";
    supplier.updatedBy = actorId || null;
    await supplier.save();
    return supplier;
};

const deactivateSupplier = async (id, actorId = null) => {
    const supplier = await findActiveSupplierOrFail(id);

    if (supplier.status === "Inactive") {
        throw new AppError("Supplier is already inactive.", 400);
    }

    supplier.status = "Inactive";
    supplier.updatedBy = actorId || null;
    await supplier.save();
    return supplier;
};

// ==========================================================
// Rating
// ==========================================================

const rateSupplier = async (id, score, actorId = null) => {
    if (score < 0 || score > 5) {
        throw new AppError("Rating must be between 0 and 5.", 400);
    }

    const supplier = await findActiveSupplierOrFail(id);
    await supplier.addRating(score);
    supplier.updatedBy = actorId || null;
    await supplier.save();
    return supplier;
};

// ==========================================================
// Reports / helpers
// ==========================================================

const getActiveSuppliers = async () => {
    return Supplier.getActiveSuppliers();
};

const getPurchaseReport = async () => {
    return Supplier.getPurchaseReport();
};

const getDueReport = async () => {
    return Supplier.getDueReport();
};

// ==========================================================
// Rich supplier profile (products / POs / GRNs / spend)
// ==========================================================

const getSupplierDetails = async (id, query = {}) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid supplier id.", 400);
    }

    const supplierId = new mongoose.Types.ObjectId(id);
    const poLimit = Math.min(Math.max(parseInt(query.poLimit, 10) || 30, 1), 100);
    const grnLimit = Math.min(Math.max(parseInt(query.grnLimit, 10) || 30, 1), 100);
    const productLimit = Math.min(
        Math.max(parseInt(query.productLimit, 10) || 100, 1),
        200
    );

    const Product = require("../model/product");
    const ProductVariant = require("../model/productVariant");
    const Inventory = require("../model/inventory");
    const ItemTrack = require("../model/itemTrack");
    const PurchaseOrder = require("../model/purchaseOrder");
    const GRN = require("../model/grn");
    const SalesOrder = require("../model/salesOrder");

    const supplier = await Supplier.findOne({
        _id: supplierId,
        isDeleted: { $ne: true }
    })
        .populate("createdBy", "firstName lastName email name")
        .populate("updatedBy", "firstName lastName email name")
        .populate("approvedBy", "firstName lastName email name");

    if (!supplier) throw new AppError("Supplier not found.", 404);

    const [
        linkedProducts,
        purchaseOrders,
        grns,
        poAgg,
        productSpend,
        openPoCount
    ] = await Promise.all([
        Product.find({
            isDeleted: { $ne: true },
            $or: [
                { "suppliers.supplierId": supplierId },
                { primarySupplierId: supplierId },
                { sourceSupplierId: supplierId }
            ]
        })
            .select(
                "name productCode sku barcode trackingType productType availableStock totalStock reservedStock stockValue sellingPrice purchasePrice costPrice otherCost wholesalePrice minimumSellingPrice maximumSellingPrice offerPrice lastPurchasePrice reorderLevel primarySupplierId suppliers status isPublished productVariants"
            )
            .sort({ name: 1 })
            .limit(productLimit)
            .lean(),

        PurchaseOrder.find({
            supplierId,
            isDeleted: { $ne: true }
        })
            .select(
                "purchaseOrderNo orderDate expectedDeliveryDate status paymentStatus grandTotal paidAmount dueAmount items warehouseId supplierNote supplierAcceptanceStatus supplierNotifiedAt supplierMessage supplierRespondedAt supplierResponseNote supplierExpectedDeliveryDate supplierDeliveryType supplierPaymentType supplierPaymentMethod supplierPartialSchedule supplierPaymentSchedule isFullyReceived totalReceivedAmount"
            )
            .populate("items.productId", "name productCode productType trackingType sku barcode")
            .sort({ orderDate: -1, createdAt: -1 })
            .limit(poLimit)
            .lean(),

        GRN.find({
            supplierId,
            isDeleted: { $ne: true }
        })
            .select(
                "grnNumber receivedDate status grandTotal totalAcceptedQuantity supplierInvoiceNo purchaseOrderId inventoryUpdated"
            )
            .populate("purchaseOrderId", "purchaseOrderNo")
            .sort({ receivedDate: -1, createdAt: -1 })
            .limit(grnLimit)
            .lean(),

        PurchaseOrder.aggregate([
            {
                $match: {
                    supplierId,
                    isDeleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: null,
                    poCount: { $sum: 1 },
                    // Financials exclude cancelled / rejected POs
                    lifetimeSpend: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Cancelled", "Rejected"]
                                    ]
                                },
                                0,
                                { $ifNull: ["$grandTotal", 0] }
                            ]
                        }
                    },
                    lifetimePaid: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Cancelled", "Rejected"]
                                    ]
                                },
                                0,
                                { $ifNull: ["$paidAmount", 0] }
                            ]
                        }
                    },
                    lifetimeDue: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Cancelled", "Rejected"]
                                    ]
                                },
                                0,
                                { $ifNull: ["$dueAmount", 0] }
                            ]
                        }
                    },
                    completedSpend: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Completed", "Closed", "Received"]
                                    ]
                                },
                                { $ifNull: ["$grandTotal", 0] },
                                0
                            ]
                        }
                    },
                    completedPoCount: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Completed", "Closed", "Received"]
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    cancelledPoCount: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Cancelled", "Rejected"]
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    totalQtyOrdered: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Cancelled", "Rejected"]
                                    ]
                                },
                                0,
                                {
                                    $reduce: {
                                        input: { $ifNull: ["$items", []] },
                                        initialValue: 0,
                                        in: {
                                            $add: [
                                                "$$value",
                                                {
                                                    $ifNull: [
                                                        "$$this.quantity",
                                                        0
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }
                    },
                    totalQtyReceived: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        "$status",
                                        ["Cancelled", "Rejected"]
                                    ]
                                },
                                0,
                                {
                                    $reduce: {
                                        input: { $ifNull: ["$items", []] },
                                        initialValue: 0,
                                        in: {
                                            $add: [
                                                "$$value",
                                                {
                                                    $ifNull: [
                                                        "$$this.receivedQuantity",
                                                        0
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }
                    },
                    lastPurchaseDate: { $max: "$orderDate" }
                }
            }
        ]),

        PurchaseOrder.aggregate([
            {
                $match: {
                    supplierId,
                    isDeleted: { $ne: true },
                    status: { $nin: ["Cancelled", "Rejected"] }
                }
            },
            { $unwind: "$items" },
            { $sort: { orderDate: 1, createdAt: 1 } },
            {
                $group: {
                    _id: {
                        productId: "$items.productId",
                        productName: "$items.productName",
                        sku: "$items.sku"
                    },
                    qtyOrdered: {
                        $sum: { $ifNull: ["$items.quantity", 0] }
                    },
                    qtyReceived: {
                        $sum: { $ifNull: ["$items.receivedQuantity", 0] }
                    },
                    spend: { $sum: { $ifNull: ["$items.total", 0] } },
                    avgUnitPrice: {
                        $avg: { $ifNull: ["$items.purchasePrice", 0] }
                    },
                    lastUnitPrice: {
                        $last: { $ifNull: ["$items.purchasePrice", 0] }
                    },
                    minUnitPrice: {
                        $min: { $ifNull: ["$items.purchasePrice", 0] }
                    },
                    maxUnitPrice: {
                        $max: { $ifNull: ["$items.purchasePrice", 0] }
                    },
                    lastPurchaseDate: { $max: "$orderDate" },
                    poCount: { $addToSet: "$_id" }
                }
            },
            {
                $project: {
                    qtyOrdered: 1,
                    qtyReceived: 1,
                    spend: 1,
                    avgUnitPrice: 1,
                    lastUnitPrice: 1,
                    minUnitPrice: 1,
                    maxUnitPrice: 1,
                    lastPurchaseDate: 1,
                    poCount: { $size: "$poCount" },
                    receiveRate: {
                        $cond: [
                            { $gt: ["$qtyOrdered", 0] },
                            {
                                $divide: ["$qtyReceived", "$qtyOrdered"]
                            },
                            0
                        ]
                    }
                }
            },
            { $sort: { spend: -1 } },
            { $limit: productLimit }
        ]),

        PurchaseOrder.countDocuments({
            supplierId,
            isDeleted: { $ne: true },
            status: {
                $nin: ["Completed", "Cancelled", "Closed", "Rejected", "Received"]
            }
        })
    ]);

    const trendPeriod = ['day', 'week', 'month', 'year'].includes(String(query.trendPeriod || '').toLowerCase())
        ? String(query.trendPeriod).toLowerCase()
        : 'month';

    const now = new Date();
    let trendFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    let trendGroup = {
        y: { $year: '$orderDate' },
        m: { $month: '$orderDate' }
    };
    if (trendPeriod === 'day') {
        trendFrom = new Date(now);
        trendFrom.setHours(0, 0, 0, 0);
        trendFrom.setDate(trendFrom.getDate() - 29);
        trendGroup = {
            y: { $year: '$orderDate' },
            m: { $month: '$orderDate' },
            d: { $dayOfMonth: '$orderDate' }
        };
    } else if (trendPeriod === 'week') {
        trendFrom = new Date(now);
        trendFrom.setHours(0, 0, 0, 0);
        trendFrom.setDate(trendFrom.getDate() - (12 * 7) + 1);
        trendGroup = {
            y: { $isoWeekYear: '$orderDate' },
            w: { $isoWeek: '$orderDate' }
        };
    } else if (trendPeriod === 'year') {
        trendFrom = new Date(now.getFullYear() - 4, 0, 1);
        trendGroup = { y: { $year: '$orderDate' } };
    }

    const [grnCount, grnAgg, spendTrendRaw, statusBreakdown, partialDeliveryCount] = await Promise.all([
        GRN.countDocuments({
            supplierId,
            isDeleted: { $ne: true }
        }),
        GRN.aggregate([
            {
                $match: {
                    supplierId,
                    isDeleted: { $ne: true },
                    status: {
                        $in: ['Completed', 'Received', 'Verified']
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    completedGrnCount: { $sum: 1 },
                    receivedValue: {
                        $sum: { $ifNull: ['$grandTotal', 0] }
                    },
                    acceptedQty: {
                        $sum: { $ifNull: ['$totalAcceptedQuantity', 0] }
                    }
                }
            }
        ]),
        PurchaseOrder.aggregate([
            {
                $match: {
                    supplierId,
                    isDeleted: { $ne: true },
                    status: { $nin: ['Cancelled', 'Rejected'] },
                    orderDate: { $gte: trendFrom }
                }
            },
            {
                $group: {
                    _id: trendGroup,
                    spend: { $sum: { $ifNull: ['$grandTotal', 0] } },
                    poCount: { $sum: 1 }
                }
            },
            { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1, '_id.w': 1 } }
        ]),
        PurchaseOrder.aggregate([
            {
                $match: {
                    supplierId,
                    isDeleted: { $ne: true }
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    amount: { $sum: { $ifNull: ['$grandTotal', 0] } }
                }
            }
        ]),
        PurchaseOrder.countDocuments({
            supplierId,
            isDeleted: { $ne: true },
            status: 'Partially Received'
        })
    ]);

    const lastGrn = grns[0] || null;
    const agg = poAgg[0] || {};
    const gAgg = grnAgg[0] || {};

    // Real ProductVariant docs + live Inventory/IMEI (same source as product details)
    const linkedProductIds = linkedProducts.map((p) => p._id);
    const variantDocs = linkedProductIds.length
        ? await ProductVariant.find({
              productId: { $in: linkedProductIds },
              isDeleted: { $ne: true }
          })
              .populate("attributes.variantTypeId", "type name")
              .populate("attributes.variantId", "name")
              .lean()
        : [];

    const [invRows, imeiRows, productInvRows, productImeiRows, soldRows] =
        linkedProductIds.length
            ? await Promise.all([
                  Inventory.aggregate([
                      {
                          $match: {
                              productId: { $in: linkedProductIds },
                              isDeleted: { $ne: true }
                          }
                      },
                      {
                          $group: {
                              _id: {
                                  productId: "$productId",
                                  variantId: "$productVariantId"
                              },
                              currentStock: { $sum: "$currentStock" },
                              availableStock: { $sum: "$availableStock" },
                              reservedStock: { $sum: "$reservedStock" }
                          }
                      }
                  ]),
                  ItemTrack.aggregate([
                      {
                          $match: {
                              productId: { $in: linkedProductIds },
                              status: "available"
                          }
                      },
                      {
                          $group: {
                              _id: {
                                  productId: "$productId",
                                  variantId: "$variantId"
                              },
                              count: { $sum: 1 }
                          }
                      }
                  ]),
                  Inventory.aggregate([
                      {
                          $match: {
                              productId: { $in: linkedProductIds },
                              isDeleted: { $ne: true }
                          }
                      },
                      {
                          $group: {
                              _id: "$productId",
                              currentStock: { $sum: "$currentStock" },
                              availableStock: { $sum: "$availableStock" },
                              reservedStock: { $sum: "$reservedStock" },
                              inventoryValue: {
                                  $sum: {
                                      $multiply: [
                                          { $ifNull: ["$currentStock", 0] },
                                          { $ifNull: ["$averageCost", 0] }
                                      ]
                                  }
                              }
                          }
                      }
                  ]),
                  ItemTrack.aggregate([
                      {
                          $match: {
                              productId: { $in: linkedProductIds },
                              status: "available"
                          }
                      },
                      {
                          $group: {
                              _id: "$productId",
                              count: { $sum: 1 }
                          }
                      }
                  ]),
                  SalesOrder.aggregate([
                      {
                          $match: {
                              isDeleted: { $ne: true },
                              $or: [
                                  { status: "Completed" },
                                  {
                                      stockUpdated: true,
                                      status: {
                                          $nin: [
                                              "Draft",
                                              "Cancelled",
                                              "Pending Approval"
                                          ]
                                      }
                                  }
                              ]
                          }
                      },
                      { $unwind: "$items" },
                      {
                          $match: {
                              "items.productId": { $in: linkedProductIds }
                          }
                      },
                      {
                          $group: {
                              _id: {
                                  productId: "$items.productId",
                                  variantId: "$items.productVariantId"
                              },
                              soldQty: {
                                  $sum: {
                                      $max: [
                                          0,
                                          {
                                              $subtract: [
                                                  {
                                                      $cond: [
                                                          {
                                                              $gt: [
                                                                  {
                                                                      $ifNull: [
                                                                          "$items.deliveredQuantity",
                                                                          0
                                                                      ]
                                                                  },
                                                                  0
                                                              ]
                                                          },
                                                          {
                                                              $ifNull: [
                                                                  "$items.deliveredQuantity",
                                                                  0
                                                              ]
                                                          },
                                                          {
                                                              $ifNull: [
                                                                  "$items.quantity",
                                                                  0
                                                              ]
                                                          }
                                                      ]
                                                  },
                                                  {
                                                      $ifNull: [
                                                          "$items.returnedQuantity",
                                                          0
                                                      ]
                                                  }
                                              ]
                                          }
                                      ]
                                  }
                              }
                          }
                      }
                  ])
              ])
            : [[], [], [], [], []];

    const invKey = (productId, variantId) =>
        `${String(productId)}::${variantId ? String(variantId) : "null"}`;

    const invMap = new Map(
        invRows.map((r) => [invKey(r._id.productId, r._id.variantId), r])
    );
    const imeiMap = new Map(
        imeiRows.map((r) => [
            invKey(r._id.productId, r._id.variantId),
            r.count || 0
        ])
    );
    const productInvMap = new Map(
        productInvRows.map((r) => [String(r._id), r])
    );
    const productImeiMap = new Map(
        productImeiRows.map((r) => [String(r._id), r.count || 0])
    );
    const soldMap = new Map(
        soldRows.map((r) => [
            invKey(r._id.productId, r._id.variantId),
            Number(r.soldQty) || 0
        ])
    );
    const productSoldMap = new Map();
    for (const r of soldRows) {
        const pid = String(r._id.productId);
        productSoldMap.set(
            pid,
            (productSoldMap.get(pid) || 0) + (Number(r.soldQty) || 0)
        );
    }

    const variantsByProduct = new Map();
    for (const v of variantDocs) {
        const pid = String(v.productId);
        if (!variantsByProduct.has(pid)) variantsByProduct.set(pid, []);
        variantsByProduct.get(pid).push(v);
    }

    const isImeiTracking = (trackingType) => {
        const tType = String(trackingType || "").toUpperCase();
        return tType.includes("IMEI") && !tType.includes("NON");
    };

    const products = linkedProducts.map((p) => {
        const link = (p.suppliers || []).find(
            (row) => String(row.supplierId) === String(supplierId)
        );
        const isPrimary =
            !!link?.isPrimary ||
            String(p.primarySupplierId || "") === String(supplierId);
        const pid = String(p._id);
        const isImei = isImeiTracking(p.trackingType);
        const rawVariants = variantsByProduct.get(pid) || [];
        const productInv = productInvMap.get(pid) || {
            currentStock: 0,
            availableStock: 0,
            reservedStock: 0,
            inventoryValue: 0
        };
        const totalImeiCount = productImeiMap.get(pid) || 0;

        const variants = rawVariants.map((v) => {
            const vid = v._id ? String(v._id) : null;
            const key = invKey(pid, vid);
            const inv = invMap.get(key) || {
                currentStock: 0,
                availableStock: 0,
                reservedStock: 0
            };
            const imeiCount = imeiMap.get(key) || 0;
            const soldQty = soldMap.get(key) || 0;
            const catalogQty = Number(v.quantity) || 0;
            const fromInv =
                Number(inv.availableStock) || Number(inv.currentStock) || 0;
            const liveQty = isImei
                ? imeiCount
                : fromInv > 0
                  ? fromInv
                  : catalogQty;
            const stockCurrent = Number(inv.currentStock) || catalogQty || 0;
            const stockAvailable = fromInv > 0 ? fromInv : catalogQty;
            const stockReserved = Number(inv.reservedStock) || 0;

            const labels = [];
            for (const attr of v.attributes || []) {
                const typeName =
                    (attr.variantTypeId &&
                        (attr.variantTypeId.name ||
                            attr.variantTypeId.type)) ||
                    "";
                const valueName =
                    (attr.variantId && attr.variantId.name) || "";
                const label = [typeName, valueName]
                    .map((x) => String(x || "").trim())
                    .filter(Boolean)
                    .join(": ");
                if (label) labels.push(label);
            }

            return {
                id: v._id,
                sku: v.sku || "",
                barcode: v.barcode || "",
                label:
                    v.combinationString ||
                    (labels.length ? labels.join(" / ") : "Variant"),
                purchasePrice: Number(v.purchasePrice) || 0,
                costPrice: Number(v.costPrice) || 0,
                sellingPrice: Number(v.sellingPrice || v.price) || 0,
                wholesalePrice: Number(v.wholesalePrice) || 0,
                offerPrice: Number(v.offerPrice) || 0,
                stockCurrent,
                stockAvailable: isImei ? imeiCount : stockAvailable,
                stockReserved,
                quantity: liveQty,
                imeiAvailableCount: imeiCount,
                soldQty,
                status: v.status || "",
                isDefaultVariant: !!v.isDefaultVariant
            };
        });

        const totalSold = productSoldMap.get(pid) || 0;
        const invAvailable = Number(productInv.availableStock) || 0;
        const invCurrent = Number(productInv.currentStock) || 0;
        const invReserved = Number(productInv.reservedStock) || 0;

        // Mirror getLiveProductStock: IMEI uses count; else inventory, else catalog
        let liveAvailable;
        let liveTotal;
        let liveReserved = invReserved || Number(p.reservedStock) || 0;
        if (isImei) {
            liveAvailable = totalImeiCount;
            liveTotal = totalImeiCount;
        } else if (invCurrent > 0 || invAvailable > 0) {
            liveAvailable = invAvailable;
            liveTotal = invCurrent;
        } else if (variants.length) {
            liveAvailable = variants.reduce(
                (s, v) => s + (Number(v.stockAvailable) || 0),
                0
            );
            liveTotal = variants.reduce(
                (s, v) => s + (Number(v.stockCurrent) || 0),
                0
            );
        } else {
            liveAvailable = Number(p.availableStock) || 0;
            liveTotal = Number(p.totalStock) || 0;
        }

        const defaultVariant =
            variants.find((v) => v.isDefaultVariant) || variants[0] || null;
        const purchasePrice =
            Number(p.purchasePrice) ||
            Number(defaultVariant?.purchasePrice) ||
            0;
        const costPrice =
            Number(p.costPrice) || Number(defaultVariant?.costPrice) || 0;
        const sellingPrice =
            Number(p.sellingPrice) ||
            Number(defaultVariant?.sellingPrice) ||
            0;
        const wholesalePrice =
            Number(p.wholesalePrice) ||
            Number(defaultVariant?.wholesalePrice) ||
            0;
        const offerPrice =
            Number(p.offerPrice) || Number(defaultVariant?.offerPrice) || 0;
        const lastPurchasePrice =
            Number(link?.lastPurchasePrice) ||
            Number(p.lastPurchasePrice) ||
            purchasePrice ||
            0;
        const unitCost =
            costPrice > 0
                ? costPrice
                : purchasePrice > 0
                  ? purchasePrice
                  : lastPurchasePrice || 0;
        const cost = unitCost + (Number(p.otherCost) || 0);
        const grossProfit = Number((sellingPrice - cost).toFixed(2));
        const profitMarginPercent =
            sellingPrice > 0
                ? Number((((sellingPrice - cost) / sellingPrice) * 100).toFixed(2))
                : 0;
        const invValue = Number(productInv.inventoryValue) || 0;
        const stockValue =
            invValue > 0
                ? Number(invValue.toFixed(2))
                : Number(
                      (
                          liveTotal *
                          (costPrice > 0 ? costPrice : purchasePrice || 0)
                      ).toFixed(2)
                  );

        return {
            productId: p._id,
            productCode: p.productCode || "",
            name: p.name || "",
            sku: p.sku || "",
            barcode: p.barcode || "",
            trackingType: p.trackingType || "Non-IMEI",
            productType: p.productType || "Simple",
            status: p.status || "",
            isPublished: !!p.isPublished,
            isPrimary,
            supplierSku: link?.supplierSku || "",
            lastPurchasePrice,
            purchasePrice,
            costPrice,
            sellingPrice,
            wholesalePrice,
            minimumSellingPrice: Number(p.minimumSellingPrice) || 0,
            maximumSellingPrice: Number(p.maximumSellingPrice) || 0,
            offerPrice,
            leadTimeDays: Number(link?.leadTimeDays) || 0,
            availableStock: liveAvailable,
            totalStock: liveTotal,
            reservedStock: liveReserved,
            totalImeiCount,
            stockValue,
            reorderLevel: Number(p.reorderLevel) || 0,
            grossProfit,
            profitMarginPercent,
            totalSold,
            variantCount: variants.length,
            variants
        };
    });

    const purchaseOrderRows = purchaseOrders.map((po) => {
        const items = po.items || [];
        const totalQty = items.reduce(
            (s, i) => s + (Number(i.quantity) || 0),
            0
        );
        const receivedQty = items.reduce(
            (s, i) => s + (Number(i.receivedQuantity) || 0),
            0
        );
        const lineSpend = items.reduce(
            (s, i) => s + (Number(i.total) || 0),
            0
        );
        return {
            id: po._id,
            purchaseOrderNo: po.purchaseOrderNo || "",
            orderDate: po.orderDate || null,
            expectedDeliveryDate: po.expectedDeliveryDate || null,
            status: po.status || "",
            paymentStatus: po.paymentStatus || "",
            grandTotal: Number(po.grandTotal) || 0,
            paidAmount: Number(po.paidAmount) || 0,
            dueAmount: Number(po.dueAmount) || 0,
            itemCount: items.length,
            totalQty,
            receivedQty,
            receiveRate: totalQty > 0 ? receivedQty / totalQty : 0,
            lineSpend,
            isFullyReceived: !!po.isFullyReceived,
            totalReceivedAmount: Number(po.totalReceivedAmount) || 0,
            supplierNote: po.supplierNote || "",
            supplierAcceptanceStatus: po.supplierAcceptanceStatus || "Not Required",
            supplierNotifiedAt: po.supplierNotifiedAt || null,
            supplierMessage: po.supplierMessage || "",
            supplierRespondedAt: po.supplierRespondedAt || null,
            supplierResponseNote: po.supplierResponseNote || "",
            supplierExpectedDeliveryDate: po.supplierExpectedDeliveryDate || null,
            supplierDeliveryType: po.supplierDeliveryType || "",
            supplierPaymentType: po.supplierPaymentType || "",
            supplierPaymentMethod: po.supplierPaymentMethod || "",
            supplierPartialSchedule: (po.supplierPartialSchedule || []).map((s) => ({
                phase: Number(s.phase) || 1,
                amount: Number(s.amount) || 0,
                amountType: s.amountType || "Fixed",
                daysFrom: Number(s.daysFrom ?? s.days) || 0,
                daysTo: Number(s.daysTo ?? s.days) || 0,
                days: Number(s.days) || 0,
                dueDate: s.dueDate || null,
                note: s.note || "",
                lineAllocations: (s.lineAllocations || []).map((a) => ({
                    productId: a.productId || null,
                    productVariantId: a.productVariantId || null,
                    productName: a.productName || "",
                    variantLabel: a.variantLabel || "",
                    sku: a.sku || "",
                    quantity: Number(a.quantity) || 0
                }))
            })),
            supplierPaymentSchedule: (po.supplierPaymentSchedule || []).map((s) => ({
                phase: Number(s.phase) || 1,
                amount: Number(s.amount) || 0,
                amountType: s.amountType || "Fixed",
                days: Number(s.days) || 0,
                dueDate: s.dueDate || null,
                method: s.method || "",
                note: s.note || ""
            })),
            items: items.map((i) => {
                const p = i.productId && typeof i.productId === "object"
                    ? i.productId
                    : null;
                return {
                    productId: p?._id || i.productId || null,
                    productVariantId: i.productVariantId || null,
                    productName: i.productName || p?.name || "",
                    productCode: p?.productCode || "",
                    productType: p?.productType || "Simple",
                    sku: i.sku || p?.sku || "",
                    barcode: p?.barcode || "",
                    variantLabel: i.variantLabel || "",
                    variantAttributes: i.variantAttributes || [],
                    quantity: Number(i.quantity) || 0,
                    receivedQuantity: Number(i.receivedQuantity) || 0,
                    purchasePrice: Number(i.purchasePrice) || 0,
                    total: Number(i.total) || 0,
                    trackingType: i.trackingType || p?.trackingType || "Non-IMEI"
                };
            })
        };
    });

    const grnRows = grns.map((g) => ({
        id: g._id,
        grnNumber: g.grnNumber || "",
        receivedDate: g.receivedDate || null,
        status: g.status || "",
        grandTotal: Number(g.grandTotal) || 0,
        totalAcceptedQuantity: Number(g.totalAcceptedQuantity) || 0,
        supplierInvoiceNo: g.supplierInvoiceNo || "",
        inventoryUpdated: !!g.inventoryUpdated,
        purchaseOrderId: g.purchaseOrderId?._id || g.purchaseOrderId || null,
        purchaseOrderNo: g.purchaseOrderId?.purchaseOrderNo || ""
    }));

    const productSpendRows = productSpend.map((row) => {
        const qtyOrdered = Number(row.qtyOrdered) || 0;
        const qtyReceived = Number(row.qtyReceived) || 0;
        return {
            productId: row._id?.productId || null,
            productName: row._id?.productName || "Unknown product",
            sku: row._id?.sku || "",
            qtyOrdered,
            qtyReceived,
            spend: Number(row.spend) || 0,
            avgUnitPrice: Number(Number(row.avgUnitPrice || 0).toFixed(2)),
            lastUnitPrice: Number(row.lastUnitPrice) || 0,
            minUnitPrice: Number(row.minUnitPrice) || 0,
            maxUnitPrice: Number(row.maxUnitPrice) || 0,
            lastPurchaseDate: row.lastPurchaseDate || null,
            poCount: Number(row.poCount) || 0,
            receiveRate: qtyOrdered > 0 ? qtyReceived / qtyOrdered : 0
        };
    });

    const lifetimeSpend = Number(agg.lifetimeSpend) || 0;
    const lifetimePaid = Number(agg.lifetimePaid) || 0;
    const lifetimeDue = Number(agg.lifetimeDue) || 0;
    const poCount = Number(agg.poCount) || 0;
    const activePoCount = Math.max(poCount - (Number(agg.cancelledPoCount) || 0), 0);
    const qtyOrdered = Number(agg.totalQtyOrdered) || 0;
    const qtyReceived = Number(agg.totalQtyReceived) || 0;
    const creditLimit = Number(supplier.creditLimit) || 0;
    const receiveRate = qtyOrdered > 0 ? qtyReceived / qtyOrdered : 0;
    const paymentRate = lifetimeSpend > 0 ? lifetimePaid / lifetimeSpend : 0;

    const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    const pad2 = (n) => String(n).padStart(2, "0");
    const spendTrend = (spendTrendRaw || []).map((row) => {
        const y = row._id?.y || 0;
        const m = row._id?.m || 0;
        const d = row._id?.d || 0;
        const w = row._id?.w || 0;
        let label = "";
        if (trendPeriod === "day") {
            label = `${pad2(d)} ${monthNames[(m || 1) - 1]}`;
        } else if (trendPeriod === "week") {
            label = `W${w} '${String(y).slice(-2)}`;
        } else if (trendPeriod === "year") {
            label = String(y);
        } else {
            label = `${monthNames[(m || 1) - 1]} ${y}`.trim();
        }
        return {
            year: y,
            month: m,
            day: d,
            week: w,
            label,
            spend: Number(row.spend) || 0,
            poCount: Number(row.poCount) || 0
        };
    });
    const monthly = spendTrend;
    const createdAt = supplier.createdAt ? new Date(supplier.createdAt) : null;
    const lifetimeDays = createdAt
        ? Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000))
        : 0;

    const summary = {
        productCount: products.length,
        primaryProductCount: products.filter((p) => p.isPrimary).length,
        poCount,
        poOpenCount: openPoCount,
        poCompletedCount: Number(agg.completedPoCount) || 0,
        poCancelledCount: Number(agg.cancelledPoCount) || 0,
        partialDeliveryCount: Number(partialDeliveryCount) || 0,
        lifetimeDays,
        grnCount,
        grnCompletedCount: Number(gAgg.completedGrnCount) || 0,
        receivedValue: Number(gAgg.receivedValue) || 0,
        acceptedQty: Number(gAgg.acceptedQty) || 0,
        lifetimeSpend,
        lifetimePaid,
        lifetimeDue,
        completedSpend: Number(agg.completedSpend) || 0,
        outstandingBalance: lifetimeDue,
        avgPoValue:
            activePoCount > 0
                ? Number((lifetimeSpend / activePoCount).toFixed(2))
                : 0,
        totalQtyOrdered: qtyOrdered,
        totalQtyReceived: qtyReceived,
        receiveRate: Number(receiveRate.toFixed(4)),
        paymentRate: Number(paymentRate.toFixed(4)),
        lastPurchaseDate:
            agg.lastPurchaseDate || supplier.lastPurchaseDate || null,
        lastPaymentDate: supplier.lastPaymentDate || null,
        lastPoNo: purchaseOrderRows[0]?.purchaseOrderNo || "",
        lastGrnNo: lastGrn?.grnNumber || "",
        creditLimit,
        creditDays: Number(supplier.creditDays) || 0,
        creditUtilization:
            creditLimit > 0
                ? Number((lifetimeDue / creditLimit).toFixed(4))
                : 0,
        creditRemaining: Math.max(creditLimit - lifetimeDue, 0),
        rating: Number(supplier.rating) || 0,
        ratingCount: Number(supplier.ratingCount) || 0,
        storedPurchaseAmount: Number(supplier.totalPurchaseAmount) || 0,
        storedPaidAmount: Number(supplier.totalPaidAmount) || 0,
        storedDueAmount: Number(supplier.totalDueAmount) || 0,
        statusBreakdown: statusBreakdown.map((row) => ({
            status: row._id || "Unknown",
            count: Number(row.count) || 0,
            amount: Number(row.amount) || 0
        })),
        monthlyTrend: monthly,
        spendTrend,
        trendPeriod
    };

    return {
        supplier,
        summary,
        products,
        purchaseOrders: purchaseOrderRows,
        grns: grnRows,
        productSpend: productSpendRows
    };
};

module.exports = {
    createSupplier,
    getSuppliers,
    getSupplierById,
    getSupplierDetails,
    updateSupplier,
    deleteSupplier,
    restoreSupplier,
    permanentDeleteSupplier,
    bulkDeleteSuppliers,
    bulkRestoreSuppliers,
    bulkPermanentDeleteSuppliers,
    getSupplierStats,
    approveSupplier,
    blockSupplier,
    activateSupplier,
    deactivateSupplier,
    rateSupplier,
    getActiveSuppliers,
    getPurchaseReport,
    getDueReport
};

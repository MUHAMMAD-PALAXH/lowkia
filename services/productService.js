const mongoose = require("mongoose");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const ItemTrack = require("../model/itemTrack");
const Inventory = require("../model/inventory");
const PurchaseOrder = require("../model/purchaseOrder");
const Supplier = require("../model/supplier");
const Category = require("../model/category");
const SubCategory = require("../model/subCategory");
const Brand = require("../model/brand");
const { generateProductCode } = require("./codeGenerator");
const { generateProductBarcode } = require("./barcodeGenerator");
const AppError = require("../utils/appError");

const NOT_DELETED = { isDeleted: { $ne: true } };

// Fields the client may never set directly.
// Stock lives in the Inventory Service, codes are generated, approval is a workflow.
// productVariants holds ObjectId refs and is rebuilt by syncVariants.
const PROTECTED_FIELDS = [
    "productVariants",
    "productCode",
    "barcode",
    "barcodeType",
    "barcodeGeneratedAt",
    "uploadedByType",
    "uploadedById",
    "uploadedByModel",
    "uploadedByName",
    "uploadedAt",
    "approvalStatus",
    "approvalRequired",
    "approvedBy",
    "approvedByName",
    "approvedAt",
    "rejectedBy",
    "rejectedByName",
    "rejectedAt",
    "rejectionReason",
    "approvalHistory",
    "submittedForApprovalAt",
    "totalStock",
    "availableStock",
    "reservedStock",
    "damagedStock",
    "inTransitStock",
    "warehouseStock",
    "totalImeiCount",
    "stockValue",
    "lastStockUpdatedAt",
    "lastPurchasePrice",
    "averagePurchasePrice",
    "lastPurchaseDate",
    "grossProfit",
    "profitMarginPercent",
    "totalViews",
    "totalShares",
    "totalWishlist",
    "averageRating",
    "totalReviews",
    "isDeleted",
    "deletedAt",
    "deletedBy",
    "createdAt",
    "updatedAt"
];

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const slugify = (value = "") =>
    value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

const pickUpdatableFields = (payload = {}) => {
    const data = { ...payload };
    PROTECTED_FIELDS.forEach((field) => delete data[field]);
    return data;
};

// ==========================================================
// Validation helpers
// ==========================================================

const validateMasterRefs = async (data, { required = false } = {}) => {
    const categoryId = toObjectId(data.proCategoryId);
    const subCategoryId = toObjectId(data.proSubCategoryId);
    const brandId = toObjectId(data.proBrandId);

    if (required) {
        if (!categoryId) throw new AppError("Category is required.", 400);
        if (!subCategoryId) throw new AppError("Sub category is required.", 400);
        if (!brandId) throw new AppError("Brand is required.", 400);
    }

    if (categoryId) {
        const category = await Category.exists({ _id: categoryId });
        if (!category) throw new AppError("Selected category not found.", 404);
    }
    if (subCategoryId) {
        const subCategory = await SubCategory.exists({ _id: subCategoryId });
        if (!subCategory) {
            throw new AppError("Selected sub category not found.", 404);
        }
    }
    if (brandId) {
        const brand = await Brand.exists({ _id: brandId });
        if (!brand) throw new AppError("Selected brand not found.", 404);
    }

    return { categoryId, subCategoryId, brandId };
};

// A product may be supplied by many suppliers. Exactly one can be primary.
const normalizeSuppliers = async (input) => {
    if (input === undefined || input === null) return undefined;
    if (!Array.isArray(input)) {
        throw new AppError("suppliers must be an array.", 400);
    }

    const seen = new Set();
    const rows = [];

    input.forEach((item) => {
        const raw = typeof item === "string" ? { supplierId: item } : item || {};
        const supplierId = toObjectId(raw.supplierId);
        if (!supplierId) return;

        const key = String(supplierId);
        if (seen.has(key)) return;
        seen.add(key);

        rows.push({
            supplierId,
            isPrimary: raw.isPrimary === true || raw.isPrimary === "true",
            supplierSku: (raw.supplierSku || "").toString().trim(),
            lastPurchasePrice: Number(raw.lastPurchasePrice) || 0,
            leadTimeDays: Number(raw.leadTimeDays) || 0,
            notes: (raw.notes || "").toString().trim()
        });
    });

    if (rows.length) {
        const count = await Supplier.countDocuments({
            _id: { $in: rows.map((r) => r.supplierId) },
            ...NOT_DELETED
        });

        if (count !== rows.length) {
            throw new AppError(
                "One or more selected suppliers are invalid or deleted.",
                400
            );
        }

        const primaries = rows.filter((r) => r.isPrimary);
        if (primaries.length === 0) {
            rows[0].isPrimary = true;
        } else if (primaries.length > 1) {
            rows.forEach((r, index) => {
                r.isPrimary = index === rows.indexOf(primaries[0]);
            });
        }
    }

    return rows;
};

const resolvePrimarySupplier = (suppliers = []) => {
    const primary = suppliers.find((s) => s.isPrimary) || suppliers[0];
    return primary ? primary.supplierId : null;
};

const normalizeUploader = (payload = {}) => {
    const allowed = ["Owner", "Employee", "Vendor"];
    const uploadedByType = allowed.includes(payload.uploadedByType)
        ? payload.uploadedByType
        : "Owner";

    const uploadedById = toObjectId(payload.uploadedById);
    let uploadedByModel = null;

    if (uploadedById) {
        uploadedByModel =
            uploadedByType === "Employee" ? "Employee" : "AdminUser";
    }

    return {
        uploadedByType,
        uploadedById,
        uploadedByModel,
        uploadedByName: (payload.uploadedByName || "").toString().trim()
    };
};

const PRODUCT_SOURCE_TYPES = ["Manual", "PurchaseOrder", "ThirdParty"];
const OWNERSHIP_TYPES = ["Owned", "ThirdParty"];

const normalizeProductSource = (payload = {}) => {
    const source =
        PRODUCT_SOURCE_TYPES.includes(payload.productSourceType)
            ? payload.productSourceType
            : "Manual";
    const ownership =
        OWNERSHIP_TYPES.includes(payload.ownershipType)
            ? payload.ownershipType
            : source === "ThirdParty"
              ? "ThirdParty"
              : "Owned";

    return {
        productSourceType: source,
        ownershipType: ownership,
        sourcePurchaseOrderId: toObjectId(payload.sourcePurchaseOrderId),
        sourcePurchaseOrderItemId: toObjectId(payload.sourcePurchaseOrderItemId),
        sourcePurchaseOrderNo: (payload.sourcePurchaseOrderNo || "")
            .toString()
            .trim(),
        sourceSupplierId: toObjectId(payload.sourceSupplierId)
    };
};

const populateProduct = (query) =>
    query
        .populate("proCategoryId", "name")
        .populate("proSubCategoryId", "name")
        .populate("proBrandId", "name")
        .populate("proVariantTypeId", "type name")
        .populate("unitId", "name shortName")
        .populate("suppliers.supplierId", "supplierCode name phone email status")
        .populate("primarySupplierId", "supplierCode name phone email status")
        .populate("warehouseStock.warehouseId", "warehouseCode warehouseName city");

const findProductOrFail = async (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid product id.", 400);
    }

    const product = await Product.findOne({ _id: id, ...NOT_DELETED });
    if (!product) throw new AppError("Product not found.", 404);

    return product;
};

const pushApproval = (product, action, actor = {}, note = "") => {
    product.approvalHistory.push({
        action,
        actorType: actor.type || "System",
        actorId: toObjectId(actor.id),
        actorName: actor.name || "",
        note,
        at: new Date()
    });
};

const getPoSourceLine = async (sourcePurchaseOrderId, sourcePurchaseOrderItemId) => {
    if (!sourcePurchaseOrderId || !sourcePurchaseOrderItemId) {
        throw new AppError(
            "sourcePurchaseOrderId and sourcePurchaseOrderItemId are required for PO-linked products.",
            400
        );
    }

    const po = await PurchaseOrder.findOne({
        _id: sourcePurchaseOrderId,
        ...NOT_DELETED
    })
        .populate("supplierId", "supplierCode name phone email")
        .populate(
            "items.productId",
            "name productCode sku trackingType productType purchasePrice costPrice sellingPrice wholesalePrice warrantyType warrantyPeriod proCategoryId proSubCategoryId proBrandId manufacturer countryOfOrigin hsnCode"
        )
        .populate(
            "items.productVariantId",
            "sku combinationString purchasePrice costPrice sellingPrice wholesalePrice"
        );

    if (!po) throw new AppError("Source purchase order not found.", 404);
    if (!["Received", "Completed"].includes(po.status)) {
        throw new AppError(
            "Only Received / Completed purchase orders can be used as a product source.",
            400
        );
    }

    const line = (po.items || []).find(
        (item) => String(item._id) === String(sourcePurchaseOrderItemId)
    );
    if (!line) {
        throw new AppError("Source purchase order line not found.", 404);
    }

    return { po, line };
};

// ==========================================================
// Variants (existing multi-variant functionality)
// ==========================================================

const normalizeAttributes = (attributes = []) =>
    (Array.isArray(attributes) ? attributes : [])
        .map((a) => ({
            variantTypeId: toObjectId(a?.variantTypeId),
            variantId: toObjectId(a?.variantId)
        }))
        .filter((a) => a.variantTypeId && a.variantId)
        .sort((a, b) =>
            String(a.variantTypeId).localeCompare(String(b.variantTypeId))
        );

const mapVariantWriteError = (err) => {
    if (err instanceof AppError) return err;
    if (err && err.code === 11000) {
        const fields = Object.keys(err.keyPattern || {});
        if (fields.includes("sku")) {
            return new AppError(
                "Duplicate variant SKU. Each combination needs a unique SKU (or leave SKU blank).",
                400
            );
        }
        if (fields.includes("barcode")) {
            return new AppError(
                "Duplicate variant barcode. Please retry — a unique barcode will be generated.",
                400
            );
        }
        // Combination conflicts are recovered in syncVariants — only surface if recovery failed
        return new AppError(
            "Could not save a variant combination. Please try again.",
            400
        );
    }
    if (err && err.name === "ValidationError") {
        return new AppError(err.message, 400);
    }
    return err;
};

/** Prefer active row, otherwise revive a soft-deleted match. */
const findVariantForUpsert = async (productId, existingId, attributes) => {
    if (existingId) {
        const byId = await ProductVariant.findOne({
            _id: existingId,
            productId
        });
        if (byId) return byId;
    }

    if (attributes.length > 0) {
        const active = await ProductVariant.findOne({
            productId,
            isDeleted: { $ne: true },
            attributes
        });
        if (active) return active;

        return ProductVariant.findOne({
            productId,
            isDeleted: true,
            attributes
        }).sort({ updatedAt: -1 });
    }

    // Simple / default variant (no attributes)
    const activeDefault = await ProductVariant.findOne({
        productId,
        isDeleted: { $ne: true },
        $or: [{ attributes: { $size: 0 } }, { attributes: [] }]
    });
    if (activeDefault) return activeDefault;

    return ProductVariant.findOne({
        productId,
        isDeleted: true,
        $or: [{ attributes: { $size: 0 } }, { attributes: [] }]
    }).sort({ updatedAt: -1 });
};

const syncVariants = async (product, variantsInput, actorId = null) => {
    if (variantsInput === undefined || variantsInput === null) return;
    if (!Array.isArray(variantsInput)) {
        throw new AppError("productVariants must be an array.", 400);
    }

    const keptIds = [];
    const vendorId =
        product.vendorId ||
        (product.uploadedByType === "Vendor" ? product.uploadedById : null) ||
        actorId;
    const seenSkus = new Set();
    const productCode = (product.productCode || "VAR").toString();

    // Legacy rows used barcode: "" which breaks the sparse unique index.
    await ProductVariant.updateMany(
        { barcode: "" },
        { $unset: { barcode: 1 } }
    );

    // Drop legacy unique indexes that blocked soft-deleted + edit re-saves.
    // New partial indexes are defined on the model.
    try {
        const indexes = await ProductVariant.collection.indexes();
        for (const idx of indexes) {
            const name = idx.name || "";
            if (
                name === "productId_1_attributes_1" ||
                name === "sku_1" ||
                name === "barcode_1"
            ) {
                // Only drop if it is the old non-partial unique form
                if (idx.unique && !idx.partialFilterExpression) {
                    await ProductVariant.collection.dropIndex(name);
                }
            }
        }
        await ProductVariant.syncIndexes();
    } catch (_) {
        // Index heal is best-effort; upsert logic below still recovers conflicts.
    }

    try {
        for (let index = 0; index < variantsInput.length; index += 1) {
            const raw = variantsInput[index];
            const sellingPrice =
                Number(raw.sellingPrice) || Number(raw.price) || 0;
            const attributes = normalizeAttributes(raw.attributes);
            const label =
                (raw.combinationString || "").toString().trim() ||
                `Variant ${index + 1}`;

            if (variantsInput.length > 1 && attributes.length === 0) {
                throw new AppError(
                    `Variant "${label}" is missing Color/Size attributes. Re-select variant values and try again.`,
                    400
                );
            }

            let sku =
                (raw.sku || "").toString().trim().toUpperCase() || undefined;
            if (!sku && variantsInput.length > 1) {
                const slug = label
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .slice(0, 24);
                sku = `${productCode}-${slug || index + 1}`;
            }
            if (sku) {
                // Same payload may list the same SKU twice — auto-suffix instead of failing.
                if (seenSkus.has(sku)) {
                    sku = `${sku}-${index + 1}`;
                }
                seenSkus.add(sku);
            }

            const existingId = toObjectId(raw._id || raw.id);
            let variantDoc = await findVariantForUpsert(
                product._id,
                existingId,
                attributes
            );

            const payload = {
                productId: product._id,
                attributes,
                combinationString: label,
                purchasePrice: Number(raw.purchasePrice) || 0,
                costPrice: Number(raw.costPrice) || 0,
                sellingPrice,
                wholesalePrice: Number(raw.wholesalePrice) || 0,
                price: sellingPrice,
                offerPrice: Number(raw.offerPrice) || 0,
                // Live stock lives in Inventory — never overwrite quantity from form
                // on edit. Opening qty only allowed when creating a brand-new variant.
                minimumStock: Number(raw.minimumStock) || 0,
                maximumStock: Number(raw.maximumStock) || 0,
                reorderLevel: Number(raw.reorderLevel) || 0,
                unitId: toObjectId(raw.unitId),
                status: raw.status || "Active",
                isDefaultVariant: raw.isDefaultVariant === true || index === 0,
                updatedBy: toObjectId(actorId),
                isDeleted: false,
                deletedAt: null,
                deletedBy: null
            };
            if (!variantDoc) {
                payload.quantity = 0;
            }

            if (sku) payload.sku = sku;
            else if (!variantDoc?.sku) payload.sku = undefined;

            // Non-IMEI: keep existing barcode on edit; generate only for new rows.
            if (product.trackingType === "Non-IMEI") {
                const incoming = (raw.barcode || "").toString().trim();
                if (incoming) {
                    payload.barcode = incoming;
                } else if (!variantDoc?.barcode) {
                    payload.barcode = await generateProductBarcode();
                }
            }

            if (variantDoc) {
                const $set = { ...payload };
                if (!payload.sku && variantDoc.sku) delete $set.sku;
                if (!payload.barcode && variantDoc.barcode) delete $set.barcode;
                variantDoc = await ProductVariant.findByIdAndUpdate(
                    variantDoc._id,
                    { $set },
                    { new: true }
                );
            } else {
                payload.createdBy = toObjectId(actorId);
                try {
                    variantDoc = await ProductVariant.create(payload);
                } catch (err) {
                    // Race / legacy unique index: update the conflicting row instead.
                    if (err && err.code === 11000) {
                        const conflict = await findVariantForUpsert(
                            product._id,
                            null,
                            attributes
                        );
                        if (!conflict) throw err;
                        const $set = { ...payload };
                        delete $set.createdBy;
                        variantDoc = await ProductVariant.findByIdAndUpdate(
                            conflict._id,
                            { $set },
                            { new: true }
                        );
                    } else {
                        throw err;
                    }
                }
            }

            if (!variantDoc) {
                throw new AppError(
                    `Failed to save variant "${label}".`,
                    500
                );
            }

            keptIds.push(variantDoc._id);

            if (
                product.trackingType === "IMEI" &&
                Array.isArray(raw.imeis) &&
                raw.imeis.length
            ) {
                const existingImeis = await ItemTrack.find({
                    productId: product._id,
                    variantId: variantDoc._id
                }).select("imei");

                const known = new Set(existingImeis.map((i) => i.imei));
                const fresh = raw.imeis
                    .map((i) => String(i).trim())
                    .filter((i) => i && !known.has(i));

                if (fresh.length) {
                    if (!vendorId) {
                        throw new AppError(
                            "Vendor / uploader id is required to register IMEIs.",
                            400
                        );
                    }

                    await ItemTrack.insertMany(
                        fresh.map((imei) => ({
                            imei,
                            productId: product._id,
                            variantId: variantDoc._id,
                            vendorId,
                            status: "available"
                        }))
                    );
                }
            }
        }

        await ProductVariant.updateMany(
            {
                productId: product._id,
                _id: { $nin: keptIds },
                isDeleted: { $ne: true }
            },
            {
                $set: {
                    isDeleted: true,
                    deletedAt: new Date(),
                    deletedBy: toObjectId(actorId)
                }
            }
        );

        product.productVariants = keptIds;
        product.hasVariants = keptIds.length > 0;
        if (product.hasVariants && product.productType === "Simple") {
            product.productType = "Variant";
        }
    } catch (err) {
        throw mapVariantWriteError(err);
    }
};

// ==========================================================
// Create
// ==========================================================

const createProduct = async (payload = {}, actorId = null) => {
    const data = pickUpdatableFields(payload);
    const name = (data.name || "").toString().trim();

    if (!name) throw new AppError("Product name is required.", 400);

    const { categoryId, subCategoryId, brandId } = await validateMasterRefs(data);

    const duplicate = await Product.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        ...NOT_DELETED
    });

    if (duplicate) {
        throw new AppError("Product with this name already exists.", 409);
    }

    const trackingType =
        data.trackingType === "IMEI" ? "IMEI" : "Non-IMEI";

    const source = normalizeProductSource(payload);
    let poSource = null;
    if (source.productSourceType === "PurchaseOrder") {
        poSource = await getPoSourceLine(
            source.sourcePurchaseOrderId,
            source.sourcePurchaseOrderItemId
        );

        const duplicateSource = await Product.findOne({
            sourcePurchaseOrderItemId: source.sourcePurchaseOrderItemId,
            isDeleted: { $ne: true }
        }).select("name productCode");
        if (duplicateSource) {
            throw new AppError(
                `This purchase-order line is already linked to product "${duplicateSource.name}" (${duplicateSource.productCode}).`,
                409
            );
        }

        if (poSource.line.productId) {
            const existingProduct = await Product.findOne({
                _id: poSource.line.productId,
                isDeleted: { $ne: true }
            }).select("name productCode");
            if (existingProduct) {
                throw new AppError(
                    `This PO line already points to existing product "${existingProduct.name}" (${existingProduct.productCode}). Open that product instead of creating a duplicate.`,
                    409
                );
            }
        }
    }

    const suppliers =
        (await normalizeSuppliers(data.suppliers)) ||
        (poSource?.po?.supplierId
            ? [
                  {
                      supplierId: poSource.po.supplierId._id || poSource.po.supplierId,
                      isPrimary: true,
                      lastPurchasePrice: Number(poSource.line.purchasePrice) || 0,
                      supplierSku: poSource.line.sku || ""
                  }
              ]
            : []);
    const uploader = normalizeUploader(payload);

    const productCode = await generateProductCode();

    // Rules: only Non IMEI products get a barcode, one per product
    let barcode = "";
    let barcodeType = "None";
    if (trackingType === "Non-IMEI") {
        barcode = await generateProductBarcode();
        barcodeType = "EAN13";
    }

    const isOwnerUpload = uploader.uploadedByType === "Owner";

    // Vendor uploads also set vendorId so the user-app /products filter works.
    // Owner / Employee still get vendorId = their account id for catalog ownership
    // (same as the old dashboard form which always set vendorId = req.user._id).
    const vendorId =
        toObjectId(payload.vendorId) ||
        uploader.uploadedById ||
        toObjectId(actorId);

    const sourceProduct = poSource?.line?.productId || null;
    const sourceVariant = poSource?.line?.productVariantId || null;

    const product = new Product({
        ...data,
        name,
        productCode,
        barcode,
        barcodeType,
        barcodeGeneratedAt: barcode ? new Date() : null,
        slug: data.slug ? slugify(data.slug) : slugify(name),
        sku:
            (data.sku || sourceVariant?.sku || sourceProduct?.sku || "")
                .toString()
                .trim()
                .toUpperCase(),
        proCategoryId: categoryId || sourceProduct?.proCategoryId || null,
        proSubCategoryId: subCategoryId || sourceProduct?.proSubCategoryId || null,
        proBrandId: brandId || sourceProduct?.proBrandId || null,
        unitId: toObjectId(data.unitId),
        proVariantTypeId: toObjectId(data.proVariantTypeId),
        trackingType,
        vendorId,
        suppliers,
        primarySupplierId: resolvePrimarySupplier(suppliers),
        productSourceType: source.productSourceType,
        ownershipType: source.ownershipType,
        sourcePurchaseOrderId: source.sourcePurchaseOrderId,
        sourcePurchaseOrderItemId: source.sourcePurchaseOrderItemId,
        sourcePurchaseOrderNo:
            source.sourcePurchaseOrderNo || poSource?.po?.purchaseOrderNo || "",
        sourceSupplierId:
            source.sourceSupplierId ||
            poSource?.po?.supplierId?._id ||
            poSource?.po?.supplierId ||
            null,
        purchasePrice:
            Number(data.purchasePrice) ||
            Number(poSource?.line?.purchasePrice) ||
            Number(sourceVariant?.purchasePrice) ||
            Number(sourceProduct?.purchasePrice) ||
            0,
        costPrice:
            Number(data.costPrice) ||
            Number(sourceVariant?.costPrice) ||
            Number(sourceProduct?.costPrice) ||
            Number(poSource?.line?.purchasePrice) ||
            0,
        sellingPrice:
            Number(data.sellingPrice) ||
            Number(sourceVariant?.sellingPrice) ||
            Number(sourceProduct?.sellingPrice) ||
            0,
        wholesalePrice:
            Number(data.wholesalePrice) ||
            Number(sourceVariant?.wholesalePrice) ||
            Number(sourceProduct?.wholesalePrice) ||
            0,
        warrantyType:
            data.warrantyType ||
            sourceProduct?.warrantyType ||
            "No Warranty",
        warrantyPeriod:
            Number(data.warrantyPeriod) ||
            Number(sourceProduct?.warrantyPeriod) ||
            0,
        manufacturer:
            (data.manufacturer || sourceProduct?.manufacturer || "")
                .toString()
                .trim(),
        countryOfOrigin:
            (data.countryOfOrigin || sourceProduct?.countryOfOrigin || "Bangladesh")
                .toString()
                .trim(),
        hsnCode:
            (data.hsnCode || sourceProduct?.hsnCode || "").toString().trim(),
        ...uploader,
        uploadedAt: new Date(),
        approvalRequired: !isOwnerUpload,
        approvalStatus: isOwnerUpload ? "Approved" : "Pending",
        approvedBy: isOwnerUpload ? actorId || null : null,
        approvedByName: isOwnerUpload ? uploader.uploadedByName : "",
        approvedAt: isOwnerUpload ? new Date() : null,
        submittedForApprovalAt: isOwnerUpload ? null : new Date(),
        createdBy: actorId || uploader.uploadedById || null
    });

    pushApproval(
        product,
        isOwnerUpload ? "Approved" : "Submitted",
        {
            type: uploader.uploadedByType,
            id: uploader.uploadedById,
            name: uploader.uploadedByName
        },
        isOwnerUpload
            ? "Auto approved (uploaded by Owner)."
            : "Waiting for Owner approval."
    );

    product.recomputeProfit();
    product.recomputeLowStock();

    // Owner uploads are immediately usable by the user app catalog
    if (isOwnerUpload) {
        product.status = "Active";
        product.isPublished = true;
        product.publishedAt = new Date();
    }

    await product.save();

    try {
        await syncVariants(product, payload.productVariants, actorId);
        if (product.isModified()) await product.save();
    } catch (err) {
        // Product row was already persisted — soft-delete so the same name
        // can be retried instead of returning "already exists".
        try {
            product.isDeleted = true;
            product.deletedAt = new Date();
            product.deletedBy = toObjectId(actorId);
            product.status = "Archived";
            product.isPublished = false;
            await product.save();
            await ProductVariant.updateMany(
                { productId: product._id, isDeleted: { $ne: true } },
                {
                    $set: {
                        isDeleted: true,
                        deletedAt: new Date(),
                        deletedBy: toObjectId(actorId)
                    }
                }
            );
        } catch (_) {
            // best-effort cleanup
        }
        throw err;
    }

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// List / Get
// ==========================================================

const getProducts = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.approvalStatus) filter.approvalStatus = query.approvalStatus;
    if (query.trackingType) filter.trackingType = query.trackingType;
    if (query.uploadedByType) filter.uploadedByType = query.uploadedByType;
    if (query.isLowStock === "true" || query.isLowStock === true) {
        filter.isLowStock = true;
    }

    const categoryId = toObjectId(query.proCategoryId || query.categoryId);
    if (categoryId) filter.proCategoryId = categoryId;

    const subCategoryId = toObjectId(query.proSubCategoryId);
    if (subCategoryId) filter.proSubCategoryId = subCategoryId;

    const brandId = toObjectId(query.proBrandId || query.brandId);
    if (brandId) filter.proBrandId = brandId;

    const supplierId = toObjectId(query.supplierId);
    if (supplierId) filter["suppliers.supplierId"] = supplierId;

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.$or = [
            { name: { $regex: search, $options: "i" } },
            { productCode: { $regex: search, $options: "i" } },
            { sku: { $regex: search, $options: "i" } },
            { barcode: { $regex: search, $options: "i" } },
            { shortDescription: { $regex: search, $options: "i" } }
        ];
    }

    const sortBy = query.sortBy || "createdAt";
    const sortOrder = query.order === "asc" ? 1 : -1;

    const [items, total] = await Promise.all([
        populateProduct(
            Product.find(filter)
                .sort({ [sortBy]: sortOrder })
                .skip(skip)
                .limit(limit)
        ),
        Product.countDocuments(filter)
    ]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        }
    };
};

const getProductById = async (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid product id.", 400);
    }

    const product = await populateProduct(
        Product.findOne({ _id: id, ...NOT_DELETED })
    );

    if (!product) throw new AppError("Product not found.", 404);

    const variants = await ProductVariant.find({
        productId: id,
        isDeleted: { $ne: true }
    })
        .populate("attributes.variantTypeId", "type name")
        .populate("attributes.variantId", "name")
        .lean();

    const result = product.toObject();
    result.productVariants = await attachLiveStockToVariants(
        product._id,
        variants,
        product.trackingType
    );

    // Prefer live Inventory totals on details (even if summary is stale)
    const live = await getLiveProductStock(product._id);
    if (live) {
        result.totalStock = live.totalStock;
        result.availableStock = live.availableStock;
        result.reservedStock = live.reservedStock;
        result.stockValue = live.stockValue;
        result.warehouseStock = live.warehouseStock;
        result.totalImeiCount = live.totalImeiCount;
    }

    return result;
};

/** Aggregate Inventory + IMEI counts onto each variant for product details */
const attachLiveStockToVariants = async (
    productId,
    variants = [],
    trackingType = "Non-IMEI"
) => {
    const pid = toObjectId(productId) || productId;
    const invRows = await Inventory.aggregate([
        {
            $match: {
                productId: pid,
                isDeleted: { $ne: true }
            }
        },
        {
            $group: {
                _id: "$productVariantId",
                currentStock: { $sum: "$currentStock" },
                availableStock: { $sum: "$availableStock" },
                reservedStock: { $sum: "$reservedStock" }
            }
        }
    ]);

    const invByVariant = new Map(
        invRows.map((r) => [r._id ? String(r._id) : "null", r])
    );

    const imeiRows = await ItemTrack.aggregate([
        { $match: { productId: pid, status: "available" } },
        { $group: { _id: "$variantId", count: { $sum: 1 } } }
    ]);
    const imeiByVariant = new Map(
        imeiRows.map((r) => [r._id ? String(r._id) : "null", r.count || 0])
    );

    const isImei =
        String(trackingType || "")
            .toUpperCase()
            .includes("IMEI") &&
        !String(trackingType || "")
            .toUpperCase()
            .includes("NON");

    return variants.map((v) => {
        const key = v._id ? String(v._id) : "null";
        const inv = invByVariant.get(key) || {
            currentStock: 0,
            availableStock: 0,
            reservedStock: 0
        };
        const imeiCount = imeiByVariant.get(key) || 0;
        const liveQty = isImei
            ? imeiCount
            : Number(inv.availableStock) || Number(inv.currentStock) || 0;

        return {
            ...v,
            // Keep catalog field, but expose live stock for UI
            stockCurrent: Number(inv.currentStock) || 0,
            stockAvailable: Number(inv.availableStock) || 0,
            stockReserved: Number(inv.reservedStock) || 0,
            imeiAvailableCount: imeiCount,
            // quantity = live warehouse stock (old + new from Inventory / IMEI)
            quantity: liveQty
        };
    });
};

const getLiveProductStock = async (productId) => {
    const pid = toObjectId(productId) || productId;
    const rows = await Inventory.aggregate([
        {
            $match: {
                productId: pid,
                isDeleted: { $ne: true }
            }
        },
        {
            $group: {
                _id: "$warehouseId",
                quantity: { $sum: "$currentStock" },
                availableQuantity: { $sum: "$availableStock" },
                reservedQuantity: { $sum: "$reservedStock" },
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
    ]);

    const totalImeiCount = await ItemTrack.countDocuments({
        productId: pid,
        status: "available"
    });

    return {
        totalStock: rows.reduce((s, r) => s + (r.quantity || 0), 0),
        availableStock: rows.reduce(
            (s, r) => s + (r.availableQuantity || 0),
            0
        ),
        reservedStock: rows.reduce(
            (s, r) => s + (r.reservedQuantity || 0),
            0
        ),
        stockValue: Number(
            rows
                .reduce((s, r) => s + (r.inventoryValue || 0), 0)
                .toFixed(2)
        ),
        warehouseStock: rows.map((row) => ({
            warehouseId: row._id,
            quantity: row.quantity || 0,
            availableQuantity: row.availableQuantity || 0,
            reservedQuantity: row.reservedQuantity || 0,
            updatedAt: new Date()
        })),
        totalImeiCount
    };
};

const getApprovedProducts = () => populateProduct(Product.getApprovedProducts());

const getPendingApprovals = () => populateProduct(Product.getPendingApprovals());

const getLowStockProducts = () => Product.getLowStockProducts();

const getProductByBarcode = async (barcode) => {
    const value = String(barcode || "").trim();
    if (!value) throw new AppError("Barcode is required.", 400);

    const product = await populateProduct(
        Product.findOne({ barcode: value, ...NOT_DELETED })
    );

    if (product) return product;

    const variant = await ProductVariant.findOne({
        barcode: value,
        isDeleted: { $ne: true }
    });

    if (!variant) throw new AppError("No product found for this barcode.", 404);

    return populateProduct(
        Product.findOne({ _id: variant.productId, ...NOT_DELETED })
    );
};

// ==========================================================
// Update
// ==========================================================

const updateProduct = async (id, payload = {}, actorId = null) => {
    const product = await findProductOrFail(id);
    const data = pickUpdatableFields(payload);

    if (data.name) {
        const name = data.name.toString().trim();
        const duplicate = await Product.findOne({
            _id: { $ne: id },
            name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
            ...NOT_DELETED
        });

        if (duplicate) {
            throw new AppError("Product with this name already exists.", 409);
        }

        data.name = name;
    }

    if (
        data.proCategoryId !== undefined ||
        data.proSubCategoryId !== undefined ||
        data.proBrandId !== undefined
    ) {
        const refs = await validateMasterRefs({
            proCategoryId: data.proCategoryId || product.proCategoryId,
            proSubCategoryId: data.proSubCategoryId || product.proSubCategoryId,
            proBrandId: data.proBrandId || product.proBrandId
        });

        data.proCategoryId = refs.categoryId;
        data.proSubCategoryId = refs.subCategoryId;
        data.proBrandId = refs.brandId;
    }

    if (data.unitId !== undefined) data.unitId = toObjectId(data.unitId);
    if (data.proVariantTypeId !== undefined) {
        data.proVariantTypeId = toObjectId(data.proVariantTypeId);
    }

    const suppliers = await normalizeSuppliers(data.suppliers);
    if (suppliers !== undefined) {
        data.suppliers = suppliers;
        data.primarySupplierId = resolvePrimarySupplier(suppliers);
    }

    // Tracking type can only change while the product has no stock or IMEI
    if (data.trackingType && data.trackingType !== product.trackingType) {
        const [imeiCount, hasStock] = await Promise.all([
            ItemTrack.countDocuments({ productId: product._id }),
            Promise.resolve((Number(product.totalStock) || 0) > 0)
        ]);

        if (imeiCount > 0 || hasStock) {
            throw new AppError(
                "Tracking type cannot change after stock or IMEI exists for this product.",
                400
            );
        }
    }

    Object.assign(product, data);

    // A Non IMEI product must always own exactly one barcode, generated once
    if (product.trackingType === "Non-IMEI" && !product.barcode) {
        product.barcode = await generateProductBarcode();
        product.barcodeType = "EAN13";
        product.barcodeGeneratedAt = new Date();
    }

    product.recomputeProfit();
    product.recomputeLowStock();
    product.updatedBy = actorId || product.updatedBy;

    await product.save();

    await syncVariants(product, payload.productVariants, actorId);
    if (product.isModified()) await product.save();

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Approval workflow
// ==========================================================

const approveProduct = async (id, actor = {}, note = "") => {
    const product = await findProductOrFail(id);

    if (product.approvalStatus === "Approved") {
        throw new AppError("Product is already approved.", 400);
    }

    product.approvalStatus = "Approved";
    product.approvedBy = toObjectId(actor.id);
    product.approvedByName = actor.name || "Owner";
    product.approvedAt = new Date();
    product.rejectedBy = null;
    product.rejectedByName = "";
    product.rejectedAt = null;
    product.rejectionReason = "";

    if (product.status === "Draft") product.status = "Active";
    // Make approved products available to the user-app catalog (/products)
    product.isPublished = true;
    product.publishedAt = new Date();

    pushApproval(product, "Approved", { ...actor, type: actor.type || "Owner" }, note);
    await product.save();

    return populateProduct(Product.findById(product._id));
};

const rejectProduct = async (id, reason = "", actor = {}) => {
    const product = await findProductOrFail(id);

    if (!String(reason).trim()) {
        throw new AppError("Rejection reason is required.", 400);
    }

    product.approvalStatus = "Rejected";
    product.rejectedBy = toObjectId(actor.id);
    product.rejectedByName = actor.name || "Owner";
    product.rejectedAt = new Date();
    product.rejectionReason = String(reason).trim();
    product.approvedBy = null;
    product.approvedByName = "";
    product.approvedAt = null;
    product.status = "Inactive";

    pushApproval(
        product,
        "Rejected",
        { ...actor, type: actor.type || "Owner" },
        product.rejectionReason
    );
    await product.save();

    return populateProduct(Product.findById(product._id));
};

const resubmitProduct = async (id, actor = {}, note = "") => {
    const product = await findProductOrFail(id);

    if (product.approvalStatus === "Approved") {
        throw new AppError("Product is already approved.", 400);
    }

    product.approvalStatus = "Pending";
    product.approvalRequired = true;
    product.submittedForApprovalAt = new Date();
    product.rejectionReason = "";

    pushApproval(product, "Resubmitted", actor, note);
    await product.save();

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Status / publish
// ==========================================================

const setStatus = async (id, status, actorId = null) => {
    const allowed = ["Draft", "Active", "Inactive", "Archived"];
    if (!allowed.includes(status)) {
        throw new AppError("Invalid product status.", 400);
    }

    const product = await findProductOrFail(id);

    if (status === "Active" && product.approvalStatus !== "Approved") {
        throw new AppError(
            "Product must be approved by the Owner before it can be activated.",
            400
        );
    }

    product.status = status;
    if (status !== "Active") product.isPublished = false;
    product.updatedBy = actorId || product.updatedBy;
    await product.save();

    return populateProduct(Product.findById(product._id));
};

const setPublish = async (id, publish, actorId = null) => {
    const product = await findProductOrFail(id);

    if (publish && product.approvalStatus !== "Approved") {
        throw new AppError(
            "Product must be approved by the Owner before publishing.",
            400
        );
    }

    if (publish) {
        product.isPublished = true;
        product.publishedAt = new Date();
        product.status = "Active";
    } else {
        product.isPublished = false;
    }

    product.updatedBy = actorId || product.updatedBy;
    await product.save();

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Suppliers
// ==========================================================

const assignSuppliers = async (id, suppliersInput, actorId = null) => {
    const product = await findProductOrFail(id);
    const suppliers = (await normalizeSuppliers(suppliersInput)) || [];

    product.suppliers = suppliers;
    product.primarySupplierId = resolvePrimarySupplier(suppliers);
    product.updatedBy = actorId || null;
    await product.save();

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Soft delete
// ==========================================================

const deleteProduct = async (id, actorId = null) => {
    const product = await findProductOrFail(id);

    if ((Number(product.totalStock) || 0) > 0) {
        throw new AppError(
            "Cannot delete product while stock exists. Clear stock first.",
            400
        );
    }

    const imeiCount = await ItemTrack.countDocuments({
        productId: product._id,
        status: { $ne: "deleted" }
    });

    if (imeiCount > 0) {
        throw new AppError(
            `Cannot delete product while ${imeiCount} IMEI record(s) exist.`,
            400
        );
    }

    const openOrder = await hasOpenPurchaseOrder(product._id);
    if (openOrder) {
        throw new AppError(
            "Cannot delete product while it is on an open purchase order.",
            400
        );
    }

    product.isDeleted = true;
    product.deletedAt = new Date();
    product.deletedBy = actorId || null;
    product.status = "Archived";
    product.isPublished = false;
    await product.save();

    await ProductVariant.updateMany(
        { productId: product._id, isDeleted: { $ne: true } },
        {
            $set: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: actorId || null
            }
        }
    );

    return product;
};

// Purchase Order module is not built yet, so this stays defensive.
const hasOpenPurchaseOrder = async (productId) => {
    try {
        const PurchaseOrder = mongoose.models.PurchaseOrder;
        if (!PurchaseOrder) return false;

        const count = await PurchaseOrder.countDocuments({
            "items.productId": productId,
            status: { $nin: ["Cancelled", "Completed", "Closed", "Rejected"] },
            isDeleted: { $ne: true }
        });

        return count > 0;
    } catch (error) {
        return false;
    }
};

const restoreProduct = async (id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid product id.", 400);
    }

    const product = await Product.findById(id);
    if (!product) throw new AppError("Product not found.", 404);

    product.isDeleted = false;
    product.deletedAt = null;
    product.deletedBy = null;
    product.status = "Inactive";
    await product.save();

    return populateProduct(Product.findById(product._id));
};

// ==========================================================
// Stock summary (written by Inventory Service only)
// ==========================================================

const refreshStockSummary = async (id) => {
    const product = await findProductOrFail(id);
    const productObjectId = product._id;

    const rows = await Inventory.aggregate([
        {
            $match: {
                productId: productObjectId,
                isDeleted: { $ne: true }
            }
        },
        {
            $group: {
                _id: "$warehouseId",
                quantity: { $sum: "$currentStock" },
                availableQuantity: { $sum: "$availableStock" },
                reservedQuantity: { $sum: "$reservedStock" },
                lastPurchasePrice: { $max: "$lastPurchasePrice" },
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
    ]);

    product.warehouseStock = rows.map((row) => ({
        warehouseId: row._id,
        quantity: row.quantity || 0,
        availableQuantity: row.availableQuantity || 0,
        reservedQuantity: row.reservedQuantity || 0,
        updatedAt: new Date()
    }));

    product.totalStock = rows.reduce((sum, r) => sum + (r.quantity || 0), 0);
    product.availableStock = rows.reduce(
        (sum, r) => sum + (r.availableQuantity || 0),
        0
    );
    product.reservedStock = rows.reduce(
        (sum, r) => sum + (r.reservedQuantity || 0),
        0
    );

    product.totalImeiCount = await ItemTrack.countDocuments({
        productId: productObjectId,
        status: "available"
    });

    const invLast = rows.reduce(
        (max, r) => Math.max(max, Number(r.lastPurchasePrice) || 0),
        0
    );
    if (invLast > 0 && !(Number(product.purchasePrice) > 0)) {
        product.purchasePrice = invLast;
    }

    // True stock value from Inventory costing (qty × averageCost per row)
    const inventoryValueSum = rows.reduce(
        (s, r) => s + (Number(r.inventoryValue) || 0),
        0
    );
    if (inventoryValueSum > 0) {
        product.stockValue = Number(inventoryValueSum.toFixed(2));
        if (product.totalStock > 0) {
            product.averagePurchasePrice = Number(
                (inventoryValueSum / product.totalStock).toFixed(2)
            );
        }
    } else {
        const unitCost =
            Number(product.averagePurchasePrice) ||
            Number(product.purchasePrice) ||
            Number(product.costPrice) ||
            invLast ||
            0;
        product.stockValue = Number((product.totalStock * unitCost).toFixed(2));
    }

    product.lastStockUpdatedAt = new Date();

    if (typeof product.recomputeLowStock === "function") {
        product.recomputeLowStock();
    }
    await product.save();

    // Keep ProductVariant.quantity in sync with live Inventory / IMEI stock
    const isImei =
        String(product.trackingType || "")
            .toUpperCase()
            .includes("IMEI") &&
        !String(product.trackingType || "")
            .toUpperCase()
            .includes("NON");

    const byVariant = await Inventory.aggregate([
        {
            $match: {
                productId: productObjectId,
                isDeleted: { $ne: true }
            }
        },
        {
            $group: {
                _id: "$productVariantId",
                qty: { $sum: "$currentStock" },
                avail: { $sum: "$availableStock" }
            }
        }
    ]);

    for (const row of byVariant) {
        if (!row._id) continue;
        let qty = Number(row.avail) || Number(row.qty) || 0;
        if (isImei) {
            qty = await ItemTrack.countDocuments({
                productId: productObjectId,
                variantId: row._id,
                status: "available"
            });
        }
        await ProductVariant.updateOne(
            { _id: row._id, isDeleted: { $ne: true } },
            { $set: { quantity: qty } }
        );
    }

    return populateProduct(Product.findById(product._id));
};

const getProductStats = async () => {
    const [rows] = await Product.aggregate([
        { $match: NOT_DELETED },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                active: {
                    $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] }
                },
                draft: {
                    $sum: { $cond: [{ $eq: ["$status", "Draft"] }, 1, 0] }
                },
                inactive: {
                    $sum: { $cond: [{ $eq: ["$status", "Inactive"] }, 1, 0] }
                },
                archived: {
                    $sum: { $cond: [{ $eq: ["$status", "Archived"] }, 1, 0] }
                },
                pendingApproval: {
                    $sum: { $cond: [{ $eq: ["$approvalStatus", "Pending"] }, 1, 0] }
                },
                rejected: {
                    $sum: { $cond: [{ $eq: ["$approvalStatus", "Rejected"] }, 1, 0] }
                },
                imei: {
                    $sum: { $cond: [{ $eq: ["$trackingType", "IMEI"] }, 1, 0] }
                },
                nonImei: {
                    $sum: { $cond: [{ $eq: ["$trackingType", "Non-IMEI"] }, 1, 0] }
                },
                lowStock: { $sum: { $cond: ["$isLowStock", 1, 0] } },
                stockValue: { $sum: "$stockValue" }
            }
        }
    ]);

    return (
        rows || {
            total: 0,
            active: 0,
            draft: 0,
            inactive: 0,
            archived: 0,
            pendingApproval: 0,
            rejected: 0,
            imei: 0,
            nonImei: 0,
            lowStock: 0,
            stockValue: 0
        }
    );
};

const getCompletedPurchaseOrderSourceLines = async (query = {}) => {
    const search = String(query.search || "").trim().toLowerCase();

    const pos = await PurchaseOrder.find({
        ...NOT_DELETED,
        status: { $in: ["Received", "Completed"] }
    })
        .populate("supplierId", "supplierCode name phone email")
        .populate(
            "items.productId",
            "name productCode sku trackingType productType purchasePrice costPrice sellingPrice wholesalePrice warrantyType warrantyPeriod proCategoryId proSubCategoryId proBrandId manufacturer countryOfOrigin hsnCode"
        )
        .populate(
            "items.productVariantId",
            "sku combinationString purchasePrice costPrice sellingPrice wholesalePrice"
        )
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

    const usedSourceIds = new Set(
        (
            await Product.find({
                sourcePurchaseOrderItemId: { $ne: null },
                isDeleted: { $ne: true }
            }).select("sourcePurchaseOrderItemId")
        ).map((p) => String(p.sourcePurchaseOrderItemId))
    );

    const rows = [];
    for (const po of pos) {
        for (const item of po.items || []) {
            const itemId = String(item._id || "");
            const existingProduct = item.productId || null;
            const blockedByExistingProduct = !!existingProduct;
            const alreadyUsedAsSource = itemId && usedSourceIds.has(itemId);

            const line = {
                purchaseOrderId: po._id,
                purchaseOrderNo: po.purchaseOrderNo,
                purchaseOrderItemId: item._id,
                supplierId: po.supplierId?._id || po.supplierId || null,
                supplierName: po.supplierId?.name || "",
                supplierCode: po.supplierId?.supplierCode || "",
                productName: item.productName || existingProduct?.name || "",
                sku: item.sku || item.productVariantId?.sku || existingProduct?.sku || "",
                trackingType: item.trackingType || existingProduct?.trackingType || "Non-IMEI",
                quantity: Number(item.quantity) || 0,
                purchasePrice: Number(item.purchasePrice) || 0,
                receivedQuantity: Number(item.receivedQuantity) || 0,
                productId: existingProduct?._id || null,
                productCode: existingProduct?.productCode || "",
                categoryId: existingProduct?.proCategoryId || item.proCategoryId || null,
                subCategoryId:
                    existingProduct?.proSubCategoryId || item.proSubCategoryId || null,
                brandId: existingProduct?.proBrandId || item.proBrandId || null,
                manufacturer: existingProduct?.manufacturer || item.manufacturer || "",
                countryOfOrigin:
                    existingProduct?.countryOfOrigin || item.countryOfOrigin || "",
                hsnCode: existingProduct?.hsnCode || item.hsnCode || "",
                warrantyType:
                    existingProduct?.warrantyType || item.warrantyType || "No Warranty",
                warrantyPeriod:
                    Number(existingProduct?.warrantyPeriod) ||
                    Number(item.warrantyPeriod) ||
                    0,
                sellingPrice:
                    Number(item.sellingPrice) ||
                    Number(item.productVariantId?.sellingPrice) ||
                    Number(existingProduct?.sellingPrice) ||
                    0,
                wholesalePrice:
                    Number(item.wholesalePrice) ||
                    Number(item.productVariantId?.wholesalePrice) ||
                    Number(existingProduct?.wholesalePrice) ||
                    0,
                duplicateBlocked: blockedByExistingProduct || alreadyUsedAsSource,
                duplicateReason: blockedByExistingProduct
                    ? `Already linked to existing product ${existingProduct.name || existingProduct.productCode || ""}`.trim()
                    : alreadyUsedAsSource
                      ? "Already converted into a product"
                      : ""
            };

            if (search) {
                const hay =
                    `${line.purchaseOrderNo} ${line.productName} ${line.sku} ${line.supplierName} ${line.productCode}`.toLowerCase();
                if (!hay.includes(search)) continue;
            }

            rows.push(line);
        }
    }

    return rows;
};

module.exports = {
    createProduct,
    getProducts,
    getProductById,
    getApprovedProducts,
    getPendingApprovals,
    getLowStockProducts,
    getProductByBarcode,
    updateProduct,
    approveProduct,
    rejectProduct,
    resubmitProduct,
    setStatus,
    setPublish,
    assignSuppliers,
    deleteProduct,
    restoreProduct,
    refreshStockSummary,
    getProductStats,
    getCompletedPurchaseOrderSourceLines
};

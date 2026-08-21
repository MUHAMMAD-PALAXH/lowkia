const asyncHandler = require("express-async-handler");
const productService = require("../services/productService");
const { success } = require("../utils/apiResponse");

const getActorId = (req) =>
    req.user?._id || req.body?.actorId || req.body?.updatedBy || null;

// Auth is deferred, so the acting user is described by the request until then.
const getActor = (req) => ({
    id: req.user?._id || req.body?.actorId || null,
    name: req.body?.actorName || req.user?.name || "Owner",
    type: req.body?.actorType || "Owner"
});

exports.createProduct = asyncHandler(async (req, res) => {
    const product = await productService.createProduct(
        req.body,
        getActorId(req),
        req.companyId
    );
    return success(res, "Product created successfully.", product, 201);
});

exports.getProducts = asyncHandler(async (req, res) => {
    const result = await productService.getProducts(req.query, req.companyId);
    return success(res, "Products retrieved successfully.", result);
});

exports.getProductStats = asyncHandler(async (req, res) => {
    const stats = await productService.getProductStats(req.companyId);
    return success(res, "Product stats retrieved successfully.", stats);
});

exports.getCompletedPurchaseOrderSourceLines = asyncHandler(async (req, res) => {
    const rows = await productService.getCompletedPurchaseOrderSourceLines(
        req.query
    );
    return success(res, "Completed purchase-order source lines retrieved.", rows);
});

exports.getApprovedProducts = asyncHandler(async (req, res) => {
    const products = await productService.getApprovedProducts(req.companyId);
    return success(res, "Approved products retrieved successfully.", products);
});

exports.getPendingApprovals = asyncHandler(async (req, res) => {
    const products = await productService.getPendingApprovals(req.companyId);
    return success(res, "Pending approvals retrieved successfully.", products);
});

exports.getLowStockProducts = asyncHandler(async (req, res) => {
    const products = await productService.getLowStockProducts(req.companyId);
    return success(res, "Low stock products retrieved successfully.", products);
});

exports.getProductByBarcode = asyncHandler(async (req, res) => {
    const product = await productService.getProductByBarcode(
        req.params.barcode,
        req.companyId
    );
    return success(res, "Product retrieved successfully.", product);
});

exports.getProductById = asyncHandler(async (req, res) => {
    const includeDeleted =
        req.query.deleted === "true" || req.query.trash === "true";
    const product = await productService.getProductById(
        req.params.id,
        {
            includeDeleted
        },
        req.companyId
    );
    return success(res, "Product retrieved successfully.", product);
});

exports.getProductDeleteCheck = asyncHandler(async (req, res) => {
    const data = await productService.getProductDeleteCheck(req.params.id);
    return success(res, "Product delete check retrieved successfully.", data);
});

exports.prepareAndTrashProduct = asyncHandler(async (req, res) => {
    const data = await productService.prepareAndTrashProduct(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Product blockers cleared and moved to trash.", data);
});

exports.bulkPrepareAndTrashProducts = asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) {
        const err = new Error("Select at least one product.");
        err.statusCode = 400;
        err.isOperational = true;
        throw err;
    }

    let deleted = 0;
    const errors = [];
    const results = [];
    for (const id of ids) {
        try {
            const data = await productService.prepareAndTrashProduct(
                id,
                getActorId(req)
            );
            deleted += 1;
            results.push(data);
        } catch (e) {
            errors.push({
                id: String(id),
                message: e?.message || "Failed"
            });
        }
    }

    if (deleted === 0 && errors.length) {
        const err = new Error(errors.map((e) => e.message).join(" | "));
        err.statusCode = 400;
        err.isOperational = true;
        err.errors = errors;
        throw err;
    }

    return success(res, "Products moved to trash.", {
        deleted,
        failed: errors.length,
        errors,
        results
    });
});

exports.updateProduct = asyncHandler(async (req, res) => {
    const product = await productService.updateProduct(
        req.params.id,
        req.body,
        getActorId(req)
    );
    return success(res, "Product updated successfully.", product);
});

exports.approveProduct = asyncHandler(async (req, res) => {
    const product = await productService.approveProduct(
        req.params.id,
        getActor(req),
        req.body?.note || ""
    );
    return success(res, "Product approved successfully.", product);
});

exports.rejectProduct = asyncHandler(async (req, res) => {
    const product = await productService.rejectProduct(
        req.params.id,
        req.body?.reason || req.body?.rejectionReason || "",
        getActor(req)
    );
    return success(res, "Product rejected.", product);
});

exports.resubmitProduct = asyncHandler(async (req, res) => {
    const product = await productService.resubmitProduct(
        req.params.id,
        getActor(req),
        req.body?.note || ""
    );
    return success(res, "Product resubmitted for approval.", product);
});

exports.setStatus = asyncHandler(async (req, res) => {
    const product = await productService.setStatus(
        req.params.id,
        req.body.status,
        getActorId(req)
    );
    return success(res, `Product status set to ${req.body.status}.`, product);
});

exports.activateProduct = asyncHandler(async (req, res) => {
    const product = await productService.setStatus(
        req.params.id,
        "Active",
        getActorId(req)
    );
    return success(res, "Product activated successfully.", product);
});

exports.deactivateProduct = asyncHandler(async (req, res) => {
    const product = await productService.setStatus(
        req.params.id,
        "Inactive",
        getActorId(req)
    );
    return success(res, "Product deactivated successfully.", product);
});

exports.archiveProduct = asyncHandler(async (req, res) => {
    const product = await productService.setStatus(
        req.params.id,
        "Archived",
        getActorId(req)
    );
    return success(res, "Product archived successfully.", product);
});

exports.publishProduct = asyncHandler(async (req, res) => {
    const product = await productService.setPublish(
        req.params.id,
        true,
        getActorId(req)
    );
    return success(res, "Product published successfully.", product);
});

exports.unpublishProduct = asyncHandler(async (req, res) => {
    const product = await productService.setPublish(
        req.params.id,
        false,
        getActorId(req)
    );
    return success(res, "Product unpublished successfully.", product);
});

exports.assignSuppliers = asyncHandler(async (req, res) => {
    const product = await productService.assignSuppliers(
        req.params.id,
        req.body.suppliers || [],
        getActorId(req)
    );
    return success(res, "Suppliers assigned successfully.", product);
});

exports.refreshStockSummary = asyncHandler(async (req, res) => {
    const product = await productService.refreshStockSummary(req.params.id);
    return success(res, "Stock summary refreshed.", product);
});

exports.deleteProduct = asyncHandler(async (req, res) => {
    await productService.deleteProduct(req.params.id, getActorId(req));
    return success(res, "Product moved to trash.");
});

exports.restoreProduct = asyncHandler(async (req, res) => {
    const product = await productService.restoreProduct(
        req.params.id,
        getActorId(req)
    );
    return success(res, "Product restored from trash.", product);
});

exports.permanentDeleteProduct = asyncHandler(async (req, res) => {
    const result = await productService.permanentDeleteProduct(req.params.id);
    return success(res, "Product permanently deleted.", result);
});

exports.bulkDeleteProducts = asyncHandler(async (req, res) => {
    const result = await productService.bulkDeleteProducts(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Products moved to trash.", result);
});

exports.bulkRestoreProducts = asyncHandler(async (req, res) => {
    const result = await productService.bulkRestoreProducts(
        req.body || {},
        getActorId(req)
    );
    return success(res, "Products restored from trash.", result);
});

exports.bulkPermanentDeleteProducts = asyncHandler(async (req, res) => {
    const result = await productService.bulkPermanentDeleteProducts(
        req.body || {}
    );
    return success(res, "Trash products permanently deleted.", result);
});

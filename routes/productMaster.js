const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");

const Product = require("../model/product");
const productController = require("../controllers/productController");
const productService = require("../services/productService");
const validate = require("../middleware/validate");
const { uploadProduct } = require("../uploadFile");
const { success, error } = require("../utils/apiResponse");
const {
    createProductValidator,
    updateProductValidator,
    statusValidator,
    rejectValidator,
    assignSuppliersValidator,
    idValidator,
    listProductValidator,
    poSourceLinesValidator
} = require("../validators/productValidator");

// Base: /api/products
// ERP product master. The legacy storefront routes stay at /products.

router.get("/", listProductValidator, validate, productController.getProducts);

router.get("/stats", productController.getProductStats);

router.post("/bulk-delete", productController.bulkDeleteProducts);
router.post("/bulk-restore", productController.bulkRestoreProducts);
router.post(
    "/bulk-permanent-delete",
    productController.bulkPermanentDeleteProducts
);

router.get("/active", productController.getApprovedProducts);

router.get("/approved", productController.getApprovedProducts);

router.get("/pending-approval", productController.getPendingApprovals);

router.get("/low-stock", productController.getLowStockProducts);

router.get(
    "/source/completed-po-lines",
    poSourceLinesValidator,
    validate,
    productController.getCompletedPurchaseOrderSourceLines
);

router.get("/barcode/:barcode", productController.getProductByBarcode);

router.get(
    "/:id/delete-check",
    idValidator,
    validate,
    productController.getProductDeleteCheck
);

router.get("/:id", idValidator, validate, productController.getProductById);

router.post("/", createProductValidator, validate, productController.createProduct);

router.put("/:id", updateProductValidator, validate, productController.updateProduct);

// ==========================================================
// Images — Cloudinary only, max 5 per product (existing uploader)
// ==========================================================

router.post(
    "/:id/images",
    idValidator,
    validate,
    asyncHandler(async (req, res) => {
        uploadProduct.array("images", 5)(req, res, async (uploadError) => {
            if (uploadError) {
                return error(res, uploadError.message, 400);
            }

            const product = await Product.findOne({
                _id: req.params.id,
                isDeleted: { $ne: true }
            });

            if (!product) {
                return error(res, "Product not found.", 404);
            }

            const files = req.files || [];
            if (!files.length) {
                return error(res, "No image file received.", 400);
            }

            if (product.images.length + files.length > 5) {
                return error(
                    res,
                    `Maximum 5 images allowed. This product already has ${product.images.length}.`,
                    400
                );
            }

            files.forEach((file, index) => {
                product.images.push({
                    url: file.path,
                    publicId: file.filename || "",
                    alt: product.name,
                    isPrimary: product.images.length === 0 && index === 0
                });
            });

            if (!product.thumbnail && product.images.length) {
                product.thumbnail = product.images[0].url;
            }

            await product.save();

            return success(res, "Images uploaded successfully.", product);
        });
    })
);

router.delete(
    "/:id/images/:publicId",
    idValidator,
    validate,
    asyncHandler(async (req, res) => {
        const product = await Product.findOne({
            _id: req.params.id,
            isDeleted: { $ne: true }
        });

        if (!product) return error(res, "Product not found.", 404);

        const publicId = decodeURIComponent(req.params.publicId);
        const before = product.images.length;

        product.images = product.images.filter(
            (image) => image.publicId !== publicId && image.url !== publicId
        );

        if (product.images.length === before) {
            return error(res, "Image not found on this product.", 404);
        }

        if (product.images.length && !product.images.some((i) => i.isPrimary)) {
            product.images[0].isPrimary = true;
        }

        product.thumbnail = product.images[0]?.url || "";
        await product.save();

        return success(res, "Image removed successfully.", product);
    })
);

// ==========================================================
// Approval workflow (Owner only in practice)
// ==========================================================

router.patch(
    "/:id/approve",
    idValidator,
    validate,
    productController.approveProduct
);

router.patch("/:id/reject", rejectValidator, validate, productController.rejectProduct);

router.patch(
    "/:id/resubmit",
    idValidator,
    validate,
    productController.resubmitProduct
);

// ==========================================================
// Status / publishing
// ==========================================================

router.patch("/:id/status", statusValidator, validate, productController.setStatus);

router.patch(
    "/:id/activate",
    idValidator,
    validate,
    productController.activateProduct
);

router.patch(
    "/:id/deactivate",
    idValidator,
    validate,
    productController.deactivateProduct
);

router.patch(
    "/:id/archive",
    idValidator,
    validate,
    productController.archiveProduct
);

router.patch(
    "/:id/publish",
    idValidator,
    validate,
    productController.publishProduct
);

router.patch(
    "/:id/unpublish",
    idValidator,
    validate,
    productController.unpublishProduct
);

// ==========================================================
// Suppliers & stock summary
// ==========================================================

router.patch(
    "/:id/suppliers",
    assignSuppliersValidator,
    validate,
    productController.assignSuppliers
);

router.patch(
    "/:id/refresh-stock",
    idValidator,
    validate,
    productController.refreshStockSummary
);

router.patch(
    "/:id/restore",
    idValidator,
    validate,
    productController.restoreProduct
);

router.delete("/:id", idValidator, validate, productController.deleteProduct);

router.delete(
    "/:id/permanent",
    idValidator,
    validate,
    productController.permanentDeleteProduct
);

module.exports = router;

const { body, param, query } = require("express-validator");

const STATUSES = ["Draft", "Active", "Inactive", "Archived"];
const APPROVAL_STATUSES = ["Pending", "Approved", "Rejected"];
const TRACKING_TYPES = ["IMEI", "Non-IMEI"];
const PRODUCT_TYPES = ["Simple", "Variant", "Digital", "Service"];
const UPLOADER_TYPES = ["Owner", "Employee", "Vendor"];
const TAX_TYPES = ["Inclusive", "Exclusive", "No Tax"];
const WARRANTY_TYPES = ["No Warranty", "Days", "Months", "Years", "Lifetime"];
const PRODUCT_SOURCE_TYPES = ["Manual", "PurchaseOrder", "ThirdParty"];
const OWNERSHIP_TYPES = ["Owned", "ThirdParty"];

const mongoIdParam = param("id")
    .isMongoId()
    .withMessage("Invalid product id.");

// Flutter sends real JSON booleans, so accept both booleans and string forms.
const optionalBoolean = (field) =>
    body(field)
        .optional({ nullable: true })
        .custom((value) => {
            if (value === undefined || value === null || value === "") return true;
            if (typeof value === "boolean") return true;
            if (
                value === "true" ||
                value === "false" ||
                value === 1 ||
                value === 0 ||
                value === "1" ||
                value === "0"
            ) {
                return true;
            }
            throw new Error(`${field} must be boolean.`);
        })
        .customSanitizer((value) => {
            if (value === true || value === "true" || value === 1 || value === "1") {
                return true;
            }
            if (
                value === false ||
                value === "false" ||
                value === 0 ||
                value === "0"
            ) {
                return false;
            }
            return value;
        });

const optionalMoney = (field) =>
    body(field)
        .optional({ nullable: true, checkFalsy: false })
        .custom((value) => {
            if (value === undefined || value === null || value === "") return true;
            if (Number.isNaN(Number(value)) || Number(value) < 0) {
                throw new Error(`${field} must be a number of 0 or more.`);
            }
            return true;
        });

const suppliersRule = body("suppliers")
    .optional({ nullable: true })
    .custom((value) => {
        if (value === undefined || value === null || value === "") return true;
        if (!Array.isArray(value)) {
            throw new Error("suppliers must be an array.");
        }
        value.forEach((item) => {
            const id =
                typeof item === "string" ? item : item && item.supplierId;
            if (!id || !/^[a-fA-F0-9]{24}$/.test(String(id))) {
                throw new Error("Invalid supplierId in suppliers.");
            }
        });
        return true;
    });

const variantsRule = body("productVariants")
    .optional({ nullable: true })
    .custom((value) => {
        if (value === undefined || value === null || value === "") return true;
        if (!Array.isArray(value)) {
            throw new Error("productVariants must be an array.");
        }
        return true;
    });

const imagesRule = body("images")
    .optional({ nullable: true })
    .custom((value) => {
        if (value === undefined || value === null || value === "") return true;
        if (!Array.isArray(value)) {
            throw new Error("images must be an array.");
        }
        if (value.length > 5) {
            throw new Error("Maximum 5 images are allowed per product.");
        }
        return true;
    });

const sharedOptionalFields = [
    body("productType").optional({ checkFalsy: true }).isIn(PRODUCT_TYPES),
    body("trackingType").optional({ checkFalsy: true }).isIn(TRACKING_TYPES),
    body("status").optional({ checkFalsy: true }).isIn(STATUSES),
    body("taxType").optional({ checkFalsy: true }).isIn(TAX_TYPES),
    body("discountType").optional({ checkFalsy: true }).isIn(["Fixed", "Percentage"]),
    body("salesTaxType").optional({ checkFalsy: true }).isIn(["Fixed", "Percentage"]),
    body("branchIds").optional().isArray(),
    body("branchIds.*").optional({ checkFalsy: true }).isMongoId(),
    body("warrantyType").optional({ checkFalsy: true }).isIn(WARRANTY_TYPES),
    body("productSourceType")
        .optional({ checkFalsy: true })
        .isIn(PRODUCT_SOURCE_TYPES),
    body("ownershipType").optional({ checkFalsy: true }).isIn(OWNERSHIP_TYPES),
    body("uploadedByType").optional({ checkFalsy: true }).isIn(UPLOADER_TYPES),
    body("uploadedById").optional({ checkFalsy: true }).isMongoId(),
    body("sourcePurchaseOrderId").optional({ checkFalsy: true }).isMongoId(),
    body("sourcePurchaseOrderItemId").optional({ checkFalsy: true }).isMongoId(),
    body("sourceSupplierId").optional({ checkFalsy: true }).isMongoId(),
    body("unitId").optional({ checkFalsy: true }).isMongoId(),
    body("proVariantTypeId").optional({ checkFalsy: true }).isMongoId(),
    optionalMoney("purchasePrice"),
    optionalMoney("costPrice"),
    optionalMoney("sellingPrice"),
    optionalMoney("wholesalePrice"),
    optionalMoney("minimumSellingPrice"),
    optionalMoney("maximumSellingPrice"),
    optionalMoney("offerPrice"),
    optionalMoney("discountValue"),
    optionalMoney("salesTaxValue"),
    optionalMoney("taxPercentage"),
    optionalMoney("minimumStock"),
    optionalMoney("maximumStock"),
    optionalMoney("reorderLevel"),
    optionalMoney("reorderQuantity"),
    optionalMoney("warrantyPeriod"),
    optionalBoolean("isFeatured"),
    optionalBoolean("isNewArrival"),
    optionalBoolean("isBestSeller"),
    optionalBoolean("isTrending"),
    optionalBoolean("isRecommended"),
    optionalBoolean("isReturnable"),
    optionalBoolean("allowBackorder"),
    optionalBoolean("isPublished"),
    optionalBoolean("showOnHomepage"),
    optionalBoolean("showInMobileApp"),
    optionalBoolean("showOnWebsite"),
    suppliersRule,
    variantsRule,
    imagesRule,
    body("productCode")
        .not()
        .exists()
        .withMessage("productCode is auto-generated and cannot be provided."),
    body("barcode")
        .not()
        .exists()
        .withMessage("barcode is auto-generated and cannot be provided.")
];

const createProductValidator = [
    body("name")
        .notEmpty()
        .withMessage("Product name is required.")
        .isLength({ min: 2, max: 200 })
        .withMessage("Product name must be between 2 and 200 characters.")
        .trim(),
    body("proCategoryId")
        .optional({ checkFalsy: true })
        .isMongoId()
        .withMessage("Invalid category id."),
    body("proSubCategoryId")
        .optional({ checkFalsy: true })
        .isMongoId()
        .withMessage("Invalid sub category id."),
    body("proBrandId")
        .optional({ checkFalsy: true })
        .isMongoId()
        .withMessage("Invalid brand id."),
    ...sharedOptionalFields
];

const updateProductValidator = [
    mongoIdParam,
    body("name")
        .optional({ checkFalsy: true })
        .isLength({ min: 2, max: 200 })
        .trim(),
    body("proCategoryId").optional({ checkFalsy: true }).isMongoId(),
    body("proSubCategoryId").optional({ checkFalsy: true }).isMongoId(),
    body("proBrandId").optional({ checkFalsy: true }).isMongoId(),
    ...sharedOptionalFields
];

const statusValidator = [
    mongoIdParam,
    body("status").notEmpty().isIn(STATUSES).withMessage("Invalid product status.")
];

const rejectValidator = [
    mongoIdParam,
    body("reason")
        .optional({ checkFalsy: true })
        .isLength({ min: 3, max: 500 })
        .trim(),
    body("rejectionReason")
        .optional({ checkFalsy: true })
        .isLength({ min: 3, max: 500 })
        .trim()
];

const assignSuppliersValidator = [mongoIdParam, suppliersRule];

const idValidator = [mongoIdParam];

const listProductValidator = [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status").optional().isIn(STATUSES),
    query("approvalStatus").optional().isIn(APPROVAL_STATUSES),
    query("trackingType").optional().isIn(TRACKING_TYPES),
    query("uploadedByType").optional().isIn(UPLOADER_TYPES),
    query("proCategoryId").optional().isMongoId(),
    query("proSubCategoryId").optional().isMongoId(),
    query("proBrandId").optional().isMongoId(),
    query("supplierId").optional().isMongoId(),
    query("search").optional().isString().trim()
];

const poSourceLinesValidator = [query("search").optional().isString().trim()];

module.exports = {
    createProductValidator,
    updateProductValidator,
    statusValidator,
    rejectValidator,
    assignSuppliersValidator,
    idValidator,
    listProductValidator,
    poSourceLinesValidator
};

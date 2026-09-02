const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const catalogService = require("../services/marketplace/marketplaceCatalogService");

exports.listProducts = asyncHandler(async (req, res) => {
    const result = await catalogService.listProducts(req.query);
    return res.status(200).json({
        success: true,
        message: "Products retrieved",
        data: result.data,
        pagination: result.pagination,
        errors: null,
    });
});

exports.getProduct = asyncHandler(async (req, res) => {
    const data = await catalogService.getProductById(req.params.id);
    return success(res, "Product retrieved", data);
});

exports.getTaxonomy = asyncHandler(async (req, res) => {
    const data = await catalogService.getTaxonomy();
    return success(res, "Taxonomy retrieved", data);
});

exports.listSellers = asyncHandler(async (req, res) => {
    const data = await catalogService.listSellers();
    return success(res, "Sellers retrieved", data);
});

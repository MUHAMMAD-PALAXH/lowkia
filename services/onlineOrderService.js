const mongoose = require("mongoose");
const Order = require("../model/order");
const AppError = require("../utils/appError");
const { companyFilter } = require("../utils/tenantScope");
const { writeActivityLog } = require("./activityLogService");
const {
    buildOnlineOrderWorkbook,
    buildExportFilename,
    MAX_EXPORT_ONLINE_ORDERS
} = require("./export/onlineOrderExcelExporter");

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Full filtered Online Orders Excel export (storefront /orders).
 */
const exportOnlineOrdersExcel = async (
    query = {},
    companyId = null,
    actor = null
) => {
    const tenant = companyFilter(companyId);
    const filter = { ...tenant };

    if (query.userId && mongoose.isValidObjectId(query.userId)) {
        filter.userID = query.userId;
    }

    const status = String(query.status || query.orderStatus || "")
        .trim()
        .toLowerCase();
    if (status && status !== "all" && status !== "all orders") {
        filter.orderStatus = status;
    }

    const search = String(query.search || "").trim();
    if (search) {
        const regex = { $regex: escapeRegex(search), $options: "i" };
        const or = [
            { paymentMethod: regex },
            { orderStatus: regex },
            { "shippingAddress.phone": regex },
            { "shippingAddress.city": regex },
            { "shippingAddress.street": regex },
            { trackingUrl: regex }
        ];
        if (mongoose.isValidObjectId(search)) {
            or.push({ _id: search });
        }
        // Match customer name/email via populated user — resolve IDs first
        const User = require("../model/user");
        const users = await User.find({
            $or: [{ name: regex }, { email: regex }]
        })
            .select("_id")
            .lean();
        if (users.length) {
            or.push({ userID: { $in: users.map((u) => u._id) } });
        }
        filter.$or = or;
    }

    const total = await Order.countDocuments(filter);
    if (total > MAX_EXPORT_ONLINE_ORDERS) {
        throw new AppError(
            `Too many matching online orders (${total}). Narrow filters (max ${MAX_EXPORT_ONLINE_ORDERS}).`,
            400
        );
    }

    const orders =
        total === 0
            ? []
            : await Order.find(filter)
                  .populate("userID", "name email")
                  .populate("couponCode", "couponCode discountType discountAmount")
                  .populate("branchId", "name branchCode code")
                  .sort({ createdAt: -1 })
                  .lean();

    const filename = buildExportFilename(query);
    const buffer = await buildOnlineOrderWorkbook({
        orders,
        meta: {
            exportedAt: new Date(),
            exportedBy:
                [actor?.firstName, actor?.lastName].filter(Boolean).join(" ") ||
                actor?.name ||
                actor?.email ||
                actor?.username ||
                "",
            companyId: companyId ? String(companyId) : "",
            filters: {
                search: query.search || "",
                status: query.status || query.orderStatus || ""
            }
        }
    });

    await writeActivityLog({
        user: actor,
        companyId,
        activityType: "Export",
        module: "Sales",
        subModule: "OnlineOrder",
        description: `Exported ${orders.length} online order(s) to Excel (${filename}).`,
        shortDescription: `Online order Excel export (${orders.length})`,
        referenceType: "System",
        referenceId: null,
        newData: {
            filename,
            orderCount: orders.length,
            filters: {
                search: query.search || "",
                status: query.status || ""
            }
        },
        securityLevel: "Medium"
    });

    return { buffer, filename, orderCount: orders.length };
};

module.exports = {
    exportOnlineOrdersExcel
};

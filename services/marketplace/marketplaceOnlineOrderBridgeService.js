const mongoose = require("mongoose");
const Order = require("../../model/order");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const MasterOrder = require("../../model/marketplace/masterOrder");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");
const CheckoutPayment = require("../../model/marketplace/checkoutPayment");
const { NOT_DELETED } = require("../../constants/marketplace");
const { companyFilter, stampCompany } = require("../../utils/tenantScope");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const mapCompanyStatusToOnline = (status = "") => {
    switch (String(status || "").toLowerCase()) {
        case "pending":
        case "confirmed":
            return "pending";
        case "processing":
        case "packed":
            return "processing";
        case "partially_shipped":
        case "shipped":
            return "shipped";
        case "delivered":
            return "delivered";
        case "cancelled":
        case "refunded":
            return "cancelled";
        default:
            return "pending";
    }
};

const mapPaymentMethod = (method = "") => {
    const normalized = String(method || "").toLowerCase();
    return normalized === "cod" ? "cod" : "prepaid";
};

const mapShippingAddress = (address = {}) => ({
    phone: String(address.phone || "").trim(),
    street: String(address.addressLine || address.street || "").trim(),
    city: String(address.city || "").trim(),
    state: String(address.district || address.state || address.area || "").trim(),
    postalCode: String(address.postalCode || "").trim(),
    country: String(address.country || "").trim() || "BD",
});

/**
 * Mirror a paid/confirmed marketplace company order into the Admin
 * "Online Orders" collection (`Order`) so Sales → Online orders shows it.
 */
const ensureOnlineOrderForCompanyOrder = async (
    companyOrderInput,
    { session = null, paymentMethod = null } = {}
) => {
    const companyOrderId = toObjectId(
        companyOrderInput?._id || companyOrderInput
    );
    if (!companyOrderId) return null;

    const companyOrder =
        companyOrderInput?.orderNumber != null
            ? companyOrderInput
            : await CompanyOrder.findOne({
                  _id: companyOrderId,
                  ...NOT_DELETED,
              }).session(session || null);

    if (!companyOrder || companyOrder.isDeleted) return null;

    if (companyOrder.onlineOrderId) {
        const existing = await Order.findById(companyOrder.onlineOrderId).session(
            session || null
        );
        if (existing) return existing;
    }

    const linked = await Order.findOne({
        companyOrderId: companyOrder._id,
        ...companyFilter(companyOrder.companyId),
    }).session(session || null);
    if (linked) {
        if (!companyOrder.onlineOrderId) {
            companyOrder.onlineOrderId = linked._id;
            await companyOrder.save({ session: session || undefined });
        }
        return linked;
    }

    const [items, masterOrder, payment] = await Promise.all([
        MarketplaceOrderItem.find({
            companyOrderId: companyOrder._id,
            ...NOT_DELETED,
        })
            .session(session || null)
            .lean(),
        MasterOrder.findOne({
            _id: companyOrder.masterOrderId,
            ...NOT_DELETED,
        })
            .session(session || null)
            .lean(),
        CheckoutPayment.findOne({
            masterOrderId: companyOrder.masterOrderId,
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .session(session || null)
            .lean(),
    ]);

    if (!items.length) return null;

    const method =
        paymentMethod ||
        payment?.paymentMethod ||
        (masterOrder?.paymentStatus === "successful" ? "prepaid" : "cod");

    const subtotal = Number(companyOrder.totals?.subtotal) || 0;
    const discount = Number(companyOrder.totals?.discount) || 0;
    const total =
        Number(companyOrder.totals?.total) ||
        items.reduce((sum, row) => sum + (Number(row.lineSubtotal) || 0), 0);

    const orderItems = items.map((item) => {
        const qty = Math.max(Number(item.quantity) || 1, 1);
        const line = Number(item.lineSubtotal) || 0;
        const unitFromProduct = Number(item.product?.unitPrice);
        const price =
            Number.isFinite(unitFromProduct) && unitFromProduct > 0
                ? unitFromProduct
                : line / qty;

        return {
            productID: item.product?.productId,
            productName: item.product?.productName || "Product",
            quantity: qty,
            price,
            variant: item.product?.variantLabel || item.product?.sku || "",
            imeis: [],
        };
    });

    const [created] = await Order.create(
        [
            stampCompany(
                {
                    userID: companyOrder.userId,
                    orderDate:
                        masterOrder?.placedAt ||
                        companyOrder.confirmedAt ||
                        companyOrder.createdAt ||
                        new Date(),
                    orderStatus: mapCompanyStatusToOnline(companyOrder.status),
                    items: orderItems,
                    totalPrice: total,
                    shippingAddress: mapShippingAddress(
                        companyOrder.shippingAddress
                    ),
                    paymentMethod: mapPaymentMethod(method),
                    orderTotal: {
                        subtotal,
                        discount,
                        total,
                    },
                    trackingUrl: "",
                    companyOrderId: companyOrder._id,
                    masterOrderId: companyOrder.masterOrderId,
                    orderNumber: companyOrder.orderNumber,
                },
                companyOrder.companyId
            ),
        ],
        { session: session || undefined }
    );

    companyOrder.onlineOrderId = created._id;
    await companyOrder.save({ session: session || undefined });

    return created;
};

const syncMasterOrderToOnlineOrders = async (
    masterOrderId,
    { session = null, paymentMethod = null } = {}
) => {
    const mid = toObjectId(masterOrderId);
    if (!mid) return [];

    const companyOrders = await CompanyOrder.find({
        masterOrderId: mid,
        ...NOT_DELETED,
    }).session(session || null);

    const synced = [];
    for (const companyOrder of companyOrders) {
        const online = await ensureOnlineOrderForCompanyOrder(companyOrder, {
            session,
            paymentMethod,
        });
        if (online) synced.push(online);
    }
    return synced;
};

/**
 * Backfill Admin Online Orders for paid marketplace company orders that
 * never got a legacy Order row (e.g. placed before the bridge existed).
 */
const backfillOnlineOrdersForCompany = async (companyId, { limit = 100 } = {}) => {
    const tenant = companyFilter(companyId);
    const pending = await CompanyOrder.find({
        ...tenant,
        ...NOT_DELETED,
        onlineOrderId: null,
        status: { $nin: ["cancelled", "refunded"] },
    })
        .sort({ createdAt: -1 })
        .limit(limit);

    if (!pending.length) return 0;

    const masterIds = [
        ...new Set(pending.map((row) => String(row.masterOrderId))),
    ];
    const paidMasters = await MasterOrder.find({
        _id: { $in: masterIds },
        paymentStatus: "successful",
        ...NOT_DELETED,
    })
        .select("_id")
        .lean();
    const paidSet = new Set(paidMasters.map((row) => String(row._id)));

    let count = 0;
    for (const companyOrder of pending) {
        if (!paidSet.has(String(companyOrder.masterOrderId))) continue;
        const created = await ensureOnlineOrderForCompanyOrder(companyOrder);
        if (created) count += 1;
    }
    return count;
};

module.exports = {
    mapCompanyStatusToOnline,
    ensureOnlineOrderForCompanyOrder,
    syncMasterOrderToOnlineOrders,
    backfillOnlineOrdersForCompany,
};

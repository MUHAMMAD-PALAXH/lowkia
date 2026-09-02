const mongoose = require("mongoose");
const Customer = require("../../model/customer");
const Warehouse = require("../../model/warehouse");
const User = require("../../model/user");
const SalesOrder = require("../../model/salesOrder");
const AppError = require("../../utils/appError");
const { NOT_DELETED } = require("../../constants/marketplace");
const { companyFilter } = require("../../utils/tenantScope");
const { createCustomer } = require("../customerService");
const { createSalesOrder } = require("../salesOrderService");
const {
    loadCompanyOrderForTenant,
} = require("./companyMarketplaceOrderService");
const MasterOrder = require("../../model/marketplace/masterOrder");
const MarketplaceOrderItem = require("../../model/marketplace/marketplaceOrderItem");
const CheckoutPayment = require("../../model/marketplace/checkoutPayment");

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const formatAddress = (address = {}) => {
    const parts = [
        address.addressLine,
        address.area,
        address.city,
        address.district,
        address.postalCode,
        address.country,
    ]
        .map((part) => String(part || "").trim())
        .filter(Boolean);
    return parts.join(", ");
};

const mapPaymentMethod = (paymentMethod = "") => {
    const method = String(paymentMethod || "").toLowerCase();
    if (method === "cod") return "Cash";
    if (method === "card") return "Card";
    if (method === "bank_transfer") return "Bank Transfer";
    if (method === "mobile_wallet") return "Mobile Wallet";
    return "Other";
};

const resolveDefaultWarehouse = async (companyId, warehouseId = null) => {
    const explicitId = toObjectId(warehouseId);
    if (explicitId) {
        const warehouse = await Warehouse.findOne({
            _id: explicitId,
            ...companyFilter(companyId),
            isDeleted: { $ne: true },
        });
        if (!warehouse) throw new AppError("Warehouse not found.", 404);
        return warehouse;
    }

    const warehouse = await Warehouse.findOne({
        ...companyFilter(companyId),
        isDeleted: { $ne: true },
        status: "Active",
    })
        .sort({ isDefault: -1, createdAt: 1 })
        .lean();

    if (!warehouse) {
        throw new AppError(
            "No active warehouse found for ERP bridge. Provide warehouseId.",
            400
        );
    }
    return warehouse;
};

const ensureErpCustomer = async ({
    companyOrder,
    user,
    companyId,
    actorId,
}) => {
    if (companyOrder.erpCustomerId) {
        const existing = await Customer.findOne({
            _id: companyOrder.erpCustomerId,
            ...companyFilter(companyId),
            isDeleted: { $ne: true },
        });
        if (existing) return existing;
    }

    const address = companyOrder.shippingAddress || {};
    const phone = String(address.phone || "").trim();
    const email = String(user?.email || "").trim().toLowerCase();
    const name =
        String(address.recipientName || "").trim() ||
        [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
        "Marketplace Customer";

    let customer = null;
    if (phone) {
        customer = await Customer.findOne({
            phone,
            ...companyFilter(companyId),
            isDeleted: { $ne: true },
        });
    }
    if (!customer && email) {
        customer = await Customer.findOne({
            email,
            ...companyFilter(companyId),
            isDeleted: { $ne: true },
        });
    }

    if (!customer) {
        customer = await createCustomer(
            {
                name,
                phone,
                email,
                address: formatAddress(address),
                customerType: "Retail",
                paymentTerms: "Cash",
                note: `Auto-created from marketplace order ${companyOrder.orderNumber}`,
            },
            actorId,
            companyId
        );
    }

    companyOrder.erpCustomerId = customer._id;
    await companyOrder.save();
    return customer;
};

const bridgeCompanyOrderToSalesOrder = async (
    companyOrderId,
    payload = {},
    companyId,
    actorId = null
) => {
    const companyOrder = await loadCompanyOrderForTenant(companyOrderId, companyId);

    if (companyOrder.salesOrderId) {
        const linked = await SalesOrder.findById(companyOrder.salesOrderId).lean();
        return {
            alreadyLinked: true,
            salesOrder: linked,
            companyOrderId: companyOrder._id,
        };
    }

    const [masterOrder, payment, items, user] = await Promise.all([
        MasterOrder.findOne({
            _id: companyOrder.masterOrderId,
            ...NOT_DELETED,
        }),
        CheckoutPayment.findOne({
            masterOrderId: companyOrder.masterOrderId,
            ...NOT_DELETED,
        })
            .sort({ createdAt: -1 })
            .lean(),
        MarketplaceOrderItem.find({
            companyOrderId: companyOrder._id,
            ...NOT_DELETED,
        }).lean(),
        User.findById(companyOrder.userId).select("firstName lastName email").lean(),
    ]);

    if (!masterOrder) throw new AppError("Master order not found.", 404);
    if (!items.length) throw new AppError("Company order has no line items.", 400);

    const customer = await ensureErpCustomer({
        companyOrder,
        user,
        companyId,
        actorId,
    });
    const warehouse = await resolveDefaultWarehouse(companyId, payload.warehouseId);

    const salesItems = items.map((item) => ({
        productId: item.product.productId,
        productVariantId: item.product.productVariantId || null,
        quantity: item.quantity,
        unitPrice: Number(item.lineSubtotal) / Number(item.quantity),
        discount: Number(item.discountAmount) || 0,
        sku: item.product.sku || "",
        productName: item.product.productName,
    }));

    const isPaid = masterOrder.paymentStatus === "successful";
    const companyTotal = Number(companyOrder.totals?.total) || 0;
    const shippingCost = Number(companyOrder.totals?.shipping) || 0;

    const salesOrder = await createSalesOrder(
        {
            companyId,
            warehouseId: warehouse._id,
            branchId: warehouse.branchId || payload.branchId || null,
            customerId: customer._id,
            customerName: customer.name,
            customerPhone: customer.phone || companyOrder.shippingAddress?.phone || "",
            referenceNumber: companyOrder.orderNumber,
            orderDate: companyOrder.confirmedAt || masterOrder.placedAt || new Date(),
            expectedDeliveryDate: companyOrder.estimatedDeliveryAt,
            deliveryAddress:
                formatAddress(companyOrder.shippingAddress) || customer.address || "",
            customerNote: masterOrder.customerNote || "",
            internalNote: `Marketplace bridge from ${companyOrder.orderNumber} / ${masterOrder.orderNumber}`,
            items: salesItems,
            shippingCost,
            paymentMethod: mapPaymentMethod(payment?.paymentMethod),
            paidAmount: isPaid ? companyTotal : 0,
            dueAmount: isPaid ? 0 : companyTotal,
            paymentStatus: isPaid ? "Paid" : "Due",
            salesType: "Retail",
        },
        actorId
    );

    companyOrder.salesOrderId = salesOrder._id || salesOrder.id;
    await companyOrder.save();

    if (isPaid && salesOrder.status === "Draft") {
        await SalesOrder.updateOne(
            { _id: companyOrder.salesOrderId },
            { $set: { status: "Confirmed" } }
        );
    }

    const refreshed = await SalesOrder.findById(companyOrder.salesOrderId).lean();

    return {
        alreadyLinked: false,
        companyOrderId: companyOrder._id,
        erpCustomerId: companyOrder.erpCustomerId,
        salesOrder: refreshed,
    };
};

module.exports = {
    bridgeCompanyOrderToSalesOrder,
    ensureErpCustomer,
};

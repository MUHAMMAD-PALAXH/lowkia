const mongoose = require("mongoose");
const MasterOrder = require("../../model/marketplace/masterOrder");
const CompanyOrder = require("../../model/marketplace/companyOrder");
const AppError = require("../../utils/appError");
const {
    NOT_DELETED,
    COMPANY_ORDER_STATUSES,
    MASTER_ORDER_STATUSES,
} = require("../../constants/marketplace");
const {
    emitStatusNotificationsFromTransition,
} = require("./marketplaceNotificationService");
const { auditMarketplaceAction } = require("./marketplaceAuditService");

const TERMINAL_COMPANY_STATUSES = new Set(["cancelled", "refunded", "delivered"]);

const CANCELLABLE_COMPANY_STATUSES = new Set([
    "pending",
    "confirmed",
    "processing",
    "packed",
]);

/** Company-order lifecycle transitions (manual + system). */
const COMPANY_ORDER_TRANSITIONS = Object.freeze({
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["packed", "cancelled"],
    packed: ["partially_shipped", "shipped", "cancelled"],
    partially_shipped: ["shipped", "partially_delivered", "delivered", "cancelled"],
    shipped: ["partially_delivered", "delivered", "cancelled"],
    partially_delivered: ["delivered", "cancelled"],
    delivered: [],
    cancelled: [],
    refunded: [],
});

const SHIPPING_STATUSES = new Set([
    "partially_shipped",
    "shipped",
    "partially_delivered",
    "delivered",
]);

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (!mongoose.isValidObjectId(value)) return null;
    return new mongoose.Types.ObjectId(value);
};

const assertValidCompanyStatus = (status) => {
    const normalized = String(status || "").trim();
    if (!COMPANY_ORDER_STATUSES.includes(normalized)) {
        throw new AppError(`Invalid company order status: ${status}`, 400);
    }
    return normalized;
};

const assertCompanyTransition = (from, to) => {
    const current = assertValidCompanyStatus(from);
    const next = assertValidCompanyStatus(to);
    if (current === next) return next;

    const allowed = COMPANY_ORDER_TRANSITIONS[current] || [];
    if (!allowed.includes(next)) {
        throw new AppError(
            `Invalid company order status transition: ${current} → ${next}`,
            400
        );
    }
    return next;
};

/**
 * Map company status to master fulfillment bucket (master has no `packed`).
 */
const normalizeCompanyStatusForMaster = (status) => {
    if (status === "packed") return "processing";
    return status;
};

/**
 * Derive aggregate MasterOrder.status from child CompanyOrder statuses.
 */
const deriveMasterOrderStatus = (companyStatuses = []) => {
    const statuses = (companyStatuses || []).map((s) => String(s || "").trim());
    if (!statuses.length) return "pending";

    const cancelledCount = statuses.filter((s) => s === "cancelled").length;
    const refundedCount = statuses.filter((s) => s === "refunded").length;
    const total = statuses.length;

    if (cancelledCount === total) return "cancelled";
    if (refundedCount === total) return "refunded";
    if (cancelledCount > 0) return "partially_cancelled";
    if (refundedCount > 0) return "partially_refunded";

    const active = statuses
        .filter((s) => s !== "cancelled" && s !== "refunded")
        .map(normalizeCompanyStatusForMaster);

    if (!active.length) return "cancelled";
    if (active.every((s) => s === "pending")) return "pending";
    if (active.every((s) => s === "confirmed")) return "confirmed";
    if (active.every((s) => s === "delivered")) return "delivered";

    if (active.some((s) => s === "delivered")) {
        return "partially_delivered";
    }

    if (active.some((s) => SHIPPING_STATUSES.has(s))) {
        const allFullyShipped = active.every((s) =>
            ["shipped", "partially_delivered", "delivered"].includes(s)
        );
        if (allFullyShipped && active.every((s) => s === "shipped")) {
            return "shipped";
        }
        return "partially_shipped";
    }

    if (
        active.some((s) => s === "processing") ||
        active.some((s) => s === "confirmed") !== active.every((s) => s === "confirmed")
    ) {
        return "processing";
    }

    const fallback = active[0];
    return MASTER_ORDER_STATUSES.includes(fallback) ? fallback : "processing";
};

const applyCompanyStatusSideEffects = (companyOrder, nextStatus, reason = "") => {
    const now = new Date();

    if (nextStatus === "confirmed" && !companyOrder.confirmedAt) {
        companyOrder.confirmedAt = now;
    }
    if (
        ["partially_shipped", "shipped"].includes(nextStatus) &&
        !companyOrder.shippedAt
    ) {
        companyOrder.shippedAt = now;
    }
    if (nextStatus === "delivered" && !companyOrder.deliveredAt) {
        companyOrder.deliveredAt = now;
    }
    if (nextStatus === "cancelled") {
        companyOrder.cancelledAt = now;
        companyOrder.cancelReason = String(reason || companyOrder.cancelReason || "").trim();
    }
};

const applyMasterStatusSideEffects = (masterOrder, nextStatus, reason = "") => {
    if (nextStatus === "cancelled" || nextStatus === "partially_cancelled") {
        if (!masterOrder.cancelledAt && nextStatus === "cancelled") {
            masterOrder.cancelledAt = new Date();
            masterOrder.cancelReason = String(reason || masterOrder.cancelReason || "").trim();
        }
    }
};

const loadCompanyOrdersForMaster = async (masterOrderId, session = null) => {
    let query = CompanyOrder.find({
        masterOrderId: toObjectId(masterOrderId),
        ...NOT_DELETED,
    }).select("status");

    if (session) query = query.session(session);
    return query.lean();
};

/**
 * Recompute and persist MasterOrder.status from its CompanyOrders.
 */
const syncMasterOrderStatus = async (
    masterOrderId,
    { session = null, reason = "" } = {}
) => {
    const id = toObjectId(masterOrderId);
    if (!id) throw new AppError("Invalid master order id.", 400);

    const companyOrders = await loadCompanyOrdersForMaster(id, session);
    const nextStatus = deriveMasterOrderStatus(
        companyOrders.map((order) => order.status)
    );

    let masterQuery = MasterOrder.findOne({ _id: id, ...NOT_DELETED });
    if (session) masterQuery = masterQuery.session(session);
    const masterOrder = await masterQuery;

    if (!masterOrder) throw new AppError("Master order not found.", 404);

    const previousStatus = masterOrder.status;
    if (previousStatus === nextStatus) {
        return { masterOrder, previousStatus, nextStatus, changed: false };
    }

    masterOrder.status = nextStatus;
    applyMasterStatusSideEffects(masterOrder, nextStatus, reason);
    await masterOrder.save({ session });

    return { masterOrder, previousStatus, nextStatus, changed: true };
};

/**
 * Transition a company order with validation and sync master aggregate.
 */
const transitionCompanyOrderStatus = async (
    companyOrder,
    nextStatus,
    { session = null, reason = "", actorId = null, allowSystem = false } = {}
) => {
    const normalizedNext = assertValidCompanyStatus(nextStatus);
    const current = companyOrder.status;

    if (normalizedNext === "cancelled" && !CANCELLABLE_COMPANY_STATUSES.has(current)) {
        throw new AppError(
            `Cannot cancel company order in "${current}" status.`,
            400
        );
    }

    if (normalizedNext === "confirmed" && current === "pending" && !allowSystem) {
        throw new AppError(
            "Company order confirmation is applied automatically after payment.",
            400
        );
    }

    if (
        ["partially_shipped", "shipped", "partially_delivered", "delivered"].includes(
            normalizedNext
        ) &&
        !allowSystem &&
        !["partially_shipped", "shipped", "partially_delivered", "delivered"].includes(
            current
        ) &&
        normalizedNext !== current
    ) {
        throw new AppError(
            "Shipping statuses are updated via shipment creation or delivery events.",
            400
        );
    }

    if (!allowSystem) {
        assertCompanyTransition(current, normalizedNext);
    }

    companyOrder.status = normalizedNext;
    applyCompanyStatusSideEffects(companyOrder, normalizedNext, reason);
    await companyOrder.save({ session });

    const syncResult = await syncMasterOrderStatus(companyOrder.masterOrderId, {
        session,
        reason,
    });

    return {
        companyOrder,
        masterOrder: syncResult.masterOrder,
        previousStatus: current,
        nextStatus: normalizedNext,
        masterStatus: syncResult.nextStatus,
        masterPreviousStatus: syncResult.previousStatus,
        masterStatusChanged: syncResult.changed,
        actorId,
    };
};

const updateCompanyOrderStatus = async (
    companyOrderId,
    payload = {},
    actorId = null,
    companyId = null
) => {
    const id = toObjectId(companyOrderId);
    if (!id) throw new AppError("Invalid company order id.", 400);

    const nextStatus = assertValidCompanyStatus(payload.status);
    const reason = String(payload.reason || payload.cancelReason || "").trim();

    const order = await CompanyOrder.findOne({
        _id: id,
        companyId: toObjectId(companyId),
        ...NOT_DELETED,
    });

    if (!order) throw new AppError("Company order not found.", 404);

    if (TERMINAL_COMPANY_STATUSES.has(order.status)) {
        throw new AppError(
            `Company order is already ${order.status} and cannot be updated.`,
            400
        );
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const result = await transitionCompanyOrderStatus(order, nextStatus, {
            session,
            reason,
            allowSystem: false,
            actorId,
        });
        await session.commitTransaction();
        void emitStatusNotificationsFromTransition(result);
        void auditMarketplaceAction({
            actor: { _id: actorId, role: "admin", companyId },
            companyId,
            activityType: "Update",
            subModule: "CompanyOrderStatus",
            description: `Company marketplace order status changed ${result.previousStatus} → ${result.nextStatus}.`,
            referenceType: "CompanyOrder",
            referenceId: result.companyOrder._id,
            oldData: { status: result.previousStatus },
            newData: { status: result.nextStatus },
            securityLevel: "High",
        });
        return result;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

module.exports = {
    COMPANY_ORDER_TRANSITIONS,
    deriveMasterOrderStatus,
    assertCompanyTransition,
    syncMasterOrderStatus,
    transitionCompanyOrderStatus,
    updateCompanyOrderStatus,
};

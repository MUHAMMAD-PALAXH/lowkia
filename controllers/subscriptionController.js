const asyncHandler = require("express-async-handler");
const { success } = require("../utils/apiResponse");
const {
    ensureDefaultPlans,
    listPlans,
    assignSubscription,
    markSubscriptionPaid,
    cancelSubscription,
    getCompanySubscription,
    listCompanySubscriptions,
    extendTrial,
    renewSubscription,
} = require("../services/subscriptionService");

exports.ensurePlans = asyncHandler(async (req, res) => {
    const created = await ensureDefaultPlans(req.user._id);
    const plans = await listPlans({});
    return success(res, "Plans ready", { created, plans });
});

exports.listPlans = asyncHandler(async (req, res) => {
    await ensureDefaultPlans(req.user._id);
    const plans = await listPlans(req.query);
    return success(res, "Plans retrieved", plans);
});

exports.assignSubscription = asyncHandler(async (req, res) => {
    const companyId = req.params.companyId || req.body?.companyId;
    const planId = req.body?.planId;
    if (!companyId || !planId) {
        return res.status(400).json({
            success: false,
            message: "companyId and planId are required.",
            data: null,
            errors: null,
        });
    }
    const sub = await assignSubscription(companyId, planId, req.user._id, {
        startTrial: req.body?.startTrial !== false,
        note: req.body?.note || "",
    });
    return success(res, "Subscription assigned", sub, 201);
});

exports.markPaid = asyncHandler(async (req, res) => {
    const subscriptionId =
        req.params.subscriptionId || req.body?.subscriptionId;
    const sub = await markSubscriptionPaid(subscriptionId, req.user, {
        paymentNote: req.body?.paymentNote || "",
        paymentMethod: req.body?.paymentMethod || "manual",
        extendFromNow: req.body?.extendFromNow !== false,
    });
    return success(res, "Subscription marked paid", sub);
});

exports.cancelSubscription = asyncHandler(async (req, res) => {
    const sub = await cancelSubscription(
        req.params.subscriptionId,
        req.user._id,
        req.body?.reason || ""
    );
    return success(res, "Subscription cancelled", sub);
});

exports.extendTrial = asyncHandler(async (req, res) => {
    const sub = await extendTrial(
        req.params.subscriptionId,
        req.user,
        {
            days: req.body?.days ?? 7,
            reason: req.body?.reason || "",
        }
    );
    return success(res, "Trial extended", sub);
});

exports.renewSubscription = asyncHandler(async (req, res) => {
    const sub = await renewSubscription(req.params.subscriptionId, req.user, {
        markPaidNow: req.body?.markPaidNow === true,
        paymentNote: req.body?.paymentNote || "",
        paymentMethod: req.body?.paymentMethod || "manual",
    });
    return success(res, "Subscription renewed", sub);
});

exports.getCompanySubscription = asyncHandler(async (req, res) => {
    const sub = await getCompanySubscription(req.params.companyId);
    return success(res, "Subscription retrieved", sub);
});

exports.listCompanySubscriptions = asyncHandler(async (req, res) => {
    const items = await listCompanySubscriptions(req.params.companyId);
    return success(res, "Subscriptions retrieved", items);
});

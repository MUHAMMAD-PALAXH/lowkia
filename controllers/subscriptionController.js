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
const {
    listPlansEnriched,
    getPlansSummary,
    getPlanDetail,
    createPlan,
    updatePlan,
    setPlanStatus,
    duplicatePlan,
    listPlanSubscribers,
} = require("../services/planService");

exports.ensurePlans = asyncHandler(async (req, res) => {
    const created = await ensureDefaultPlans(req.user._id);
    const plans = await listPlansEnriched({});
    return success(res, "Plans ready", { created, plans });
});

exports.listPlans = asyncHandler(async (req, res) => {
    await ensureDefaultPlans(req.user._id);
    // Prefer enriched list for Global Console; fall back path still works.
    const plans = await listPlansEnriched(req.query);
    return success(res, "Plans retrieved", plans);
});

exports.getPlansSummary = asyncHandler(async (req, res) => {
    await ensureDefaultPlans(req.user._id);
    const data = await getPlansSummary();
    return success(res, "Plans summary", data);
});

exports.getPlan = asyncHandler(async (req, res) => {
    const plan = await getPlanDetail(req.params.id);
    return success(res, "Plan retrieved", plan);
});

exports.createPlan = asyncHandler(async (req, res) => {
    const plan = await createPlan(req.body || {}, req.user);
    return success(res, "Plan created", plan, 201);
});

exports.updatePlan = asyncHandler(async (req, res) => {
    const plan = await updatePlan(req.params.id, req.body || {}, req.user);
    return success(res, "Plan updated", plan);
});

exports.activatePlan = asyncHandler(async (req, res) => {
    const plan = await setPlanStatus(req.params.id, "Active", req.user);
    return success(res, "Plan activated", plan);
});

exports.deactivatePlan = asyncHandler(async (req, res) => {
    const plan = await setPlanStatus(req.params.id, "Inactive", req.user);
    return success(res, "Plan deactivated", plan);
});

exports.archivePlan = asyncHandler(async (req, res) => {
    const plan = await setPlanStatus(req.params.id, "Archived", req.user);
    return success(res, "Plan archived", plan);
});

exports.duplicatePlan = asyncHandler(async (req, res) => {
    const plan = await duplicatePlan(req.params.id, req.user);
    return success(res, "Plan duplicated", plan, 201);
});

exports.listPlanSubscribers = asyncHandler(async (req, res) => {
    const items = await listPlanSubscribers(req.params.id);
    return success(res, "Plan subscribers", items);
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
    // Only Active plans for new assignments
    const plan = await getPlanDetail(planId);
    if (plan.status !== "Active") {
        return res.status(400).json({
            success: false,
            message: "Only Active plans can be assigned to new subscriptions.",
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
    const sub = await extendTrial(req.params.subscriptionId, req.user, {
        days: req.body?.days ?? 7,
        reason: req.body?.reason || "",
    });
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

// keep raw listPlans for internal callers that still import subscriptionService
exports._listPlansRaw = listPlans;
